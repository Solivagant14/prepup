/**
 * The Postgres adapter for the core's repository port. Every query is
 * scoped by workspace_id (and user_id where data is personal), so one user
 * can never read or change another workspace's rows through this class.
 */
import type { Importance, Score } from "@prepup/contracts";
import type { EventRecord, NewEvent, PrepUpRepository, SettingsPatch, TopicRecord, TopicState } from "@prepup/core";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";
import { memberships, reviewEvents, topicSettings, topics, workspaces } from "./schema.js";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

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

  listTopicStates(workspaceId: string, userId: string): Promise<TopicState[]> {
    return this.states(workspaceId, userId);
  }

  async getTopicState(workspaceId: string, userId: string, topicId: string): Promise<TopicState | null> {
    const [state] = await this.states(workspaceId, userId, topicId);
    return state ?? null;
  }

  async upsertSettings(userId: string, topicId: string, patch: SettingsPatch, now: Date): Promise<void> {
    await this.db
      .insert(topicSettings)
      .values({ userId, topicId, ...patch, updatedAt: now })
      .onConflictDoUpdate({
        target: [topicSettings.userId, topicSettings.topicId],
        set: { ...patch, updatedAt: now },
      });
  }

  /** Settings and review events go with it through ON DELETE CASCADE. */
  async deleteTopic(workspaceId: string, topicId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(topics)
      .where(and(eq(topics.workspaceId, workspaceId), eq(topics.id, topicId)))
      .returning({ id: topics.id });
    return deleted.length > 0;
  }

  async appendEvent(event: NewEvent): Promise<void> {
    await this.db.insert(reviewEvents).values(event);
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
   * Topics plus the two facts each score is computed from: the latest scored
   * event and the latest Claude test. DISTINCT ON keeps one row per topic.
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

    const [rows, scored, tested] = await Promise.all([
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
    ]);

    const lastScore = new Map(scored.map((s) => [s.topicId, { score: s.score as Score, at: s.at }]));
    const lastTest = new Map(tested.map((t) => [t.topicId, t.at]));
    return rows.map((r) => ({
      topic: r.topic,
      importance: (r.importance ?? "medium") as Importance,
      explanation: r.explanation ?? "",
      lastScore: lastScore.get(r.topic.id) ?? null,
      lastTestAt: lastTest.get(r.topic.id) ?? null,
    }));
  }
}
