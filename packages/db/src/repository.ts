/**
 * The Postgres adapter for the core's repository port. Every query is
 * scoped by workspace_id (and user_id where data is personal), so one user
 * can never read or change another workspace's rows through this class.
 */
import type { Importance, Score } from "@prepup/contracts";
import type {
  ChangeSet,
  EventRecord,
  LinkPair,
  PrepUpRepository,
  TopicLink,
  TopicLinks,
  TopicRecord,
  TopicState,
} from "@prepup/core";
import type { EventSource } from "@prepup/contracts";
import { and, count, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";
import {
  memberships,
  rateLimits,
  reviewEvents,
  topicLinks,
  topicSettings,
  topics,
  userSettings,
  workspaces,
} from "./schema.js";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Postgres's code for "relation does not exist". */
const UNDEFINED_TABLE = "42P01";

/**
 * Reading links before the topic_links migration has run gives "no links"
 * instead of an error, so a deploy that lands ahead of the migration still
 * shows the deck. Writing a link still fails until the table exists.
 */
async function noLinksUntilMigrated<T>(read: () => Promise<T>, none: T): Promise<T> {
  try {
    return await read();
  } catch (err) {
    for (let e: unknown = err; e instanceof Error; e = e.cause) {
      if ((e as { code?: unknown }).code === UNDEFINED_TABLE && e.message.includes("topic_links")) {
        console.error("topic_links is missing: run pnpm db:migrate. Showing topics without links.");
        return none;
      }
    }
    throw err;
  }
}

export class PostgresRepository implements PrepUpRepository {
  constructor(private readonly db: Db) {}

  async ensurePersonalWorkspace(userId: string, now: Date): Promise<string> {
    const existing = await this.findPersonalWorkspace(userId);
    if (existing) return existing;
    await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(workspaces)
        .values({ name: "Personal", ownerId: userId, personal: true, createdAt: now })
        .onConflictDoNothing()
        .returning({ id: workspaces.id });
      if (created) {
        await tx.insert(memberships).values({ workspaceId: created.id, userId, role: "owner", createdAt: now });
      }
    });
    const id = await this.findPersonalWorkspace(userId);
    if (!id) throw new Error("Could not create a personal workspace");
    return id;
  }

  async insertTopicIfAbsent(topic: Omit<TopicRecord, "id">) {
    const [inserted] = await this.db
      .insert(topics)
      .values(topic)
      .onConflictDoNothing({ target: [topics.workspaceId, topics.normalizedTerm] })
      .returning();
    if (inserted) return { record: inserted, created: true };
    const existing = await this.findTopicByNormalizedTerm(topic.workspaceId, topic.normalizedTerm);
    if (!existing) throw new Error("Topic insert conflicted but no existing topic was found");
    return { record: existing, created: false };
  }

  async findTopicByNormalizedTerm(workspaceId: string, normalizedTerm: string): Promise<TopicRecord | null> {
    const [row] = await this.db
      .select()
      .from(topics)
      .where(and(eq(topics.workspaceId, workspaceId), eq(topics.normalizedTerm, normalizedTerm)))
      .limit(1);
    return row ?? null;
  }

  async countTopics(workspaceId: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(topics).where(eq(topics.workspaceId, workspaceId));
    return row?.n ?? 0;
  }

  listTopicStates(workspaceId: string, userId: string): Promise<TopicState[]> {
    return this.states(workspaceId, userId);
  }

  async getTopicState(workspaceId: string, userId: string, topicId: string): Promise<TopicState | null> {
    const [state] = await this.states(workspaceId, userId, topicId);
    return state ?? null;
  }

  /** One transaction: the settings change and its events commit together or not at all. */
  async applyChanges({ settings, events }: ChangeSet): Promise<void> {
    if (!settings && events.length === 0) return;
    await this.db.transaction(async (tx) => {
      if (settings) {
        const { userId, topicId, patch, now } = settings;
        await tx
          .insert(topicSettings)
          .values({ userId, topicId, ...patch, updatedAt: now })
          .onConflictDoUpdate({
            target: [topicSettings.userId, topicSettings.topicId],
            set: { ...patch, updatedAt: now },
          });
      }
      if (events.length > 0) await tx.insert(reviewEvents).values(events);
    });
  }

  /** Settings, review events and links go with it through ON DELETE CASCADE. */
  async deleteTopic(workspaceId: string, topicId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(topics)
      .where(and(eq(topics.workspaceId, workspaceId), eq(topics.id, topicId)))
      .returning({ id: topics.id });
    return deleted.length > 0;
  }

  async listTopicRecords(workspaceId: string): Promise<TopicRecord[]> {
    return this.db.select().from(topics).where(eq(topics.workspaceId, workspaceId));
  }

  /**
   * One transaction. Locking the workspace row first makes links in the same
   * workspace save one at a time, so the core's check always sees every link
   * that is already there: two opposite links sent together can't both pass.
   */
  async insertLinkIfAbsent(link: TopicLink, check: (existing: LinkPair[]) => void): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, link.workspaceId)).for("update");
      // Both ends must be this workspace's topics, whatever the caller checked.
      const ends = await tx
        .select({ id: topics.id })
        .from(topics)
        .where(and(eq(topics.workspaceId, link.workspaceId), or(eq(topics.id, link.topicId), eq(topics.id, link.buildsOnId))));
      if (ends.length !== 2) throw new Error("A link needs two different topics in the same workspace");
      const existing = await tx
        .select({ topicId: topicLinks.topicId, buildsOnId: topicLinks.buildsOnId })
        .from(topicLinks)
        .where(eq(topicLinks.workspaceId, link.workspaceId));
      if (existing.some((l) => l.topicId === link.topicId && l.buildsOnId === link.buildsOnId)) return false;
      check(existing);
      const inserted = await tx.insert(topicLinks).values(link).onConflictDoNothing().returning({ id: topicLinks.topicId });
      return inserted.length > 0;
    });
  }

  async deleteLink(workspaceId: string, topicId: string, buildsOnId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(topicLinks)
      .where(
        and(eq(topicLinks.workspaceId, workspaceId), eq(topicLinks.topicId, topicId), eq(topicLinks.buildsOnId, buildsOnId)),
      )
      .returning({ id: topicLinks.topicId });
    return deleted.length > 0;
  }

  /** Both directions in one query: the join gives each row the term of the topic at the other end. */
  async listLinksForTopic(workspaceId: string, topicId: string): Promise<TopicLinks> {
    const query = this.db
      .select({ topicId: topicLinks.topicId, buildsOnId: topicLinks.buildsOnId, otherId: topics.id, otherTerm: topics.term })
      .from(topicLinks)
      .innerJoin(
        topics,
        or(
          and(eq(topicLinks.topicId, topicId), eq(topics.id, topicLinks.buildsOnId)),
          and(eq(topicLinks.buildsOnId, topicId), eq(topics.id, topicLinks.topicId)),
        ),
      )
      .where(and(eq(topicLinks.workspaceId, workspaceId), eq(topics.workspaceId, workspaceId)));
    const rows = await noLinksUntilMigrated(() => query, []);
    const ref = (r: (typeof rows)[number]) => ({ id: r.otherId, term: r.otherTerm });
    return {
      buildsOn: rows.filter((r) => r.topicId === topicId).map(ref),
      neededFor: rows.filter((r) => r.buildsOnId === topicId).map(ref),
    };
  }

  async listLinks(workspaceId: string): Promise<LinkPair[]> {
    const query = this.db
      .select({ topicId: topicLinks.topicId, buildsOnId: topicLinks.buildsOnId })
      .from(topicLinks)
      .where(eq(topicLinks.workspaceId, workspaceId));
    return noLinksUntilMigrated(() => query, []);
  }

  async getTestingStyle(userId: string) {
    const [row] = await this.db
      .select({ text: userSettings.testingStyle, updatedAt: userSettings.updatedAt })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async saveTestingStyle(userId: string, text: string, now: Date): Promise<void> {
    await this.db
      .insert(userSettings)
      .values({ userId, testingStyle: text, updatedAt: now })
      .onConflictDoUpdate({ target: userSettings.userId, set: { testingStyle: text, updatedAt: now } });
  }

  /**
   * One transaction. Deleting the personal workspace cascades to its topics,
   * settings, events and links; the other deletes cover rows the user has in
   * workspaces they don't own (none until collaboration exists).
   */
  async deleteUserData(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(workspaces).where(and(eq(workspaces.ownerId, userId), eq(workspaces.personal, true)));
      await tx.delete(reviewEvents).where(eq(reviewEvents.userId, userId));
      await tx.delete(topicLinks).where(eq(topicLinks.createdBy, userId));
      await tx.delete(topicSettings).where(eq(topicSettings.userId, userId));
      await tx.delete(memberships).where(eq(memberships.userId, userId));
      await tx.delete(userSettings).where(eq(userSettings.userId, userId));
      await tx.delete(rateLimits).where(eq(rateLimits.userId, userId));
    });
  }

  async listEvents(workspaceId: string, userId: string, topicId: string): Promise<EventRecord[]> {
    const rows = await this.db
      .select()
      .from(reviewEvents)
      .where(
        and(eq(reviewEvents.workspaceId, workspaceId), eq(reviewEvents.userId, userId), eq(reviewEvents.topicId, topicId)),
      )
      .orderBy(desc(reviewEvents.createdAt));
    return rows.map((r) => ({ ...r, score: r.score as Score | null }));
  }

  private async findPersonalWorkspace(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.ownerId, userId), eq(workspaces.personal, true)))
      .limit(1);
    return row?.id ?? null;
  }

  /**
   * Topics plus the facts each view is computed from: the latest scored event,
   * the latest Claude test and the latest explanation change. DISTINCT ON
   * keeps one row per topic.
   */
  private async states(workspaceId: string, userId: string, topicId?: string): Promise<TopicState[]> {
    const topicFilter = topicId
      ? and(eq(topics.workspaceId, workspaceId), eq(topics.id, topicId))
      : eq(topics.workspaceId, workspaceId);
    const eventScope = (extra: ReturnType<typeof eq>) =>
      and(
        eq(reviewEvents.workspaceId, workspaceId),
        eq(reviewEvents.userId, userId),
        extra,
        topicId ? eq(reviewEvents.topicId, topicId) : undefined,
      );

    const [rows, scored, tested, explained] = await Promise.all([
      this.db
        .select({ topic: topics, importance: topicSettings.importance, explanation: topicSettings.explanation })
        .from(topics)
        .leftJoin(topicSettings, and(eq(topicSettings.topicId, topics.id), eq(topicSettings.userId, userId)))
        .where(topicFilter),
      this.db
        .selectDistinctOn([reviewEvents.topicId], {
          topicId: reviewEvents.topicId,
          score: reviewEvents.score,
          at: reviewEvents.createdAt,
        })
        .from(reviewEvents)
        .where(eventScope(isNotNull(reviewEvents.score) as ReturnType<typeof eq>))
        .orderBy(reviewEvents.topicId, desc(reviewEvents.createdAt)),
      this.db
        .selectDistinctOn([reviewEvents.topicId], { topicId: reviewEvents.topicId, at: reviewEvents.createdAt })
        .from(reviewEvents)
        .where(eventScope(eq(reviewEvents.kind, "claude_test")))
        .orderBy(reviewEvents.topicId, desc(reviewEvents.createdAt)),
      this.db
        .selectDistinctOn([reviewEvents.topicId], {
          topicId: reviewEvents.topicId,
          at: reviewEvents.createdAt,
          source: reviewEvents.source,
        })
        .from(reviewEvents)
        .where(eventScope(eq(reviewEvents.kind, "explanation")))
        .orderBy(reviewEvents.topicId, desc(reviewEvents.createdAt)),
    ]);

    const lastScore = new Map(scored.map((s) => [s.topicId, { score: s.score as Score, at: s.at }]));
    const lastTest = new Map(tested.map((t) => [t.topicId, t.at]));
    const lastExplanation = new Map(explained.map((e) => [e.topicId, { at: e.at, source: e.source as EventSource }]));
    return rows.map((r) => ({
      topic: r.topic,
      importance: (r.importance ?? "medium") as Importance,
      explanation: r.explanation ?? "",
      lastScore: lastScore.get(r.topic.id) ?? null,
      lastTestAt: lastTest.get(r.topic.id) ?? null,
      lastExplanation: lastExplanation.get(r.topic.id) ?? null,
    }));
  }

  /** Counts and the database's size on disk. Nothing here is per workspace, so nothing is scoped. */
  async hostUsage() {
    const [[people], [topicRows], sized] = await Promise.all([
      this.db.select({ n: count() }).from(workspaces).where(eq(workspaces.personal, true)),
      this.db.select({ n: count() }).from(topics),
      this.db.execute<{ bytes: string | number }>(sql`select pg_database_size(current_database()) as bytes`),
    ]);
    // Drivers disagree on the shape of a raw result: node-postgres wraps the rows, PGlite may too.
    const row = (Array.isArray(sized) ? sized[0] : (sized as { rows?: Array<{ bytes: string | number }> }).rows?.[0]) as
      | { bytes: string | number }
      | undefined;
    const bytes = row ? Number(row.bytes) : NaN;
    return { people: people?.n ?? 0, topics: topicRows?.n ?? 0, databaseBytes: Number.isFinite(bytes) ? bytes : null };
  }
}
