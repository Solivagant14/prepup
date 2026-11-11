/**
 * An in-memory adapter for the repository port. Used by unit tests and handy
 * for local experiments; behaves like the Postgres adapter.
 */
import { randomUUID } from "node:crypto";
import type { Importance, Score } from "@prepup/contracts";
import type { LinkPair } from "./links.js";
import type {
  ChangeSet,
  EventRecord,
  PrepUpRepository,
  SettingsPatch,
  TopicLink,
  TopicRecord,
  TopicState,
} from "./ports.js";

export class InMemoryRepository implements PrepUpRepository {
  private workspaces = new Map<string, string>(); // owner userId -> workspaceId
  private topics: TopicRecord[] = [];
  private settings = new Map<string, { importance: Importance; explanation: string }>();
  private events: EventRecord[] = [];
  private styles = new Map<string, { text: string; updatedAt: Date }>();
  private links: TopicLink[] = [];

  async ensurePersonalWorkspace(userId: string): Promise<string> {
    let id = this.workspaces.get(userId);
    if (!id) {
      id = randomUUID();
      this.workspaces.set(userId, id);
    }
    return id;
  }

  async insertTopicIfAbsent(topic: Omit<TopicRecord, "id">) {
    const existing = await this.findTopicByNormalizedTerm(topic.workspaceId, topic.normalizedTerm);
    if (existing) return { record: existing, created: false };
    const record = { ...topic, id: randomUUID() };
    this.topics.push(record);
    return { record, created: true };
  }

  async findTopicByNormalizedTerm(workspaceId: string, normalizedTerm: string) {
    return this.topics.find((t) => t.workspaceId === workspaceId && t.normalizedTerm === normalizedTerm) ?? null;
  }

  async countTopics(workspaceId: string) {
    return this.topics.filter((t) => t.workspaceId === workspaceId).length;
  }

  async listTopicStates(workspaceId: string, userId: string): Promise<TopicState[]> {
    return this.topics.filter((t) => t.workspaceId === workspaceId).map((t) => this.state(t, userId));
  }

  async getTopicState(workspaceId: string, userId: string, topicId: string) {
    const t = this.topics.find((x) => x.id === topicId && x.workspaceId === workspaceId);
    return t ? this.state(t, userId) : null;
  }

  /** Validates everything first, then writes, so a failure leaves nothing half-saved (like a transaction). */
  async applyChanges({ settings, events }: ChangeSet) {
    for (const e of events) {
      if (e.score !== null && (e.score < 1 || e.score > 5)) throw new Error("score out of range");
      if (e.kind === "claude_test" && e.score === 5 && !e.explained) throw new Error("unearned 5");
    }
    if (settings) this.upsertSettings(settings.userId, settings.topicId, settings.patch);
    for (const e of events) this.events.push({ ...e, id: randomUUID() });
  }

  private upsertSettings(userId: string, topicId: string, patch: SettingsPatch) {
    const key = `${userId}:${topicId}`;
    const current = this.settings.get(key) ?? { importance: "medium" as Importance, explanation: "" };
    this.settings.set(key, { ...current, ...patch });
  }

  async deleteTopic(workspaceId: string, topicId: string) {
    const before = this.topics.length;
    this.topics = this.topics.filter((t) => !(t.id === topicId && t.workspaceId === workspaceId));
    if (this.topics.length === before) return false;
    this.events = this.events.filter((e) => e.topicId !== topicId);
    this.links = this.links.filter((l) => l.topicId !== topicId && l.buildsOnId !== topicId);
    for (const key of this.settings.keys()) if (key.endsWith(`:${topicId}`)) this.settings.delete(key);
    return true;
  }

  async listTopicRecords(workspaceId: string) {
    return this.topics.filter((t) => t.workspaceId === workspaceId);
  }

  async insertLinkIfAbsent(link: TopicLink, check: (existing: LinkPair[]) => void) {
    if (link.topicId === link.buildsOnId) throw new Error("self-link");
    const inWorkspace = (id: string) => this.topics.some((t) => t.id === id && t.workspaceId === link.workspaceId);
    if (!inWorkspace(link.topicId) || !inWorkspace(link.buildsOnId)) throw new Error("link outside the workspace");
    const existing = await this.listLinks(link.workspaceId);
    if (existing.some((l) => l.topicId === link.topicId && l.buildsOnId === link.buildsOnId)) return false;
    check(existing);
    this.links.push({ ...link });
    return true;
  }

  async deleteLink(workspaceId: string, topicId: string, buildsOnId: string) {
    const before = this.links.length;
    this.links = this.links.filter(
      (l) => !(l.workspaceId === workspaceId && l.topicId === topicId && l.buildsOnId === buildsOnId),
    );
    return this.links.length < before;
  }

  async listLinksForTopic(workspaceId: string, topicId: string) {
    const mine = this.links.filter((l) => l.workspaceId === workspaceId);
    const ref = (id: string) => {
      const t = this.topics.find((x) => x.id === id)!;
      return { id: t.id, term: t.term };
    };
    return {
      buildsOn: mine.filter((l) => l.topicId === topicId).map((l) => ref(l.buildsOnId)),
      neededFor: mine.filter((l) => l.buildsOnId === topicId).map((l) => ref(l.topicId)),
    };
  }

  async listLinks(workspaceId: string): Promise<LinkPair[]> {
    return this.links
      .filter((l) => l.workspaceId === workspaceId)
      .map(({ topicId, buildsOnId }) => ({ topicId, buildsOnId }));
  }

  async getTestingStyle(userId: string) {
    return this.styles.get(userId) ?? null;
  }

  async saveTestingStyle(userId: string, text: string, now: Date) {
    this.styles.set(userId, { text, updatedAt: now });
  }

  async deleteUserData(userId: string) {
    this.styles.delete(userId);
    const workspaceId = this.workspaces.get(userId);
    this.workspaces.delete(userId);
    const gone = new Set(this.topics.filter((t) => t.workspaceId === workspaceId).map((t) => t.id));
    this.topics = this.topics.filter((t) => !gone.has(t.id));
    this.events = this.events.filter((e) => e.userId !== userId && !gone.has(e.topicId));
    this.links = this.links.filter((l) => l.createdBy !== userId && !gone.has(l.topicId) && !gone.has(l.buildsOnId));
    for (const key of this.settings.keys()) {
      const [owner, topicId] = key.split(":");
      if (owner === userId || gone.has(topicId!)) this.settings.delete(key);
    }
  }

  async listEvents(workspaceId: string, userId: string, topicId: string) {
    return this.events.filter((e) => e.workspaceId === workspaceId && e.userId === userId && e.topicId === topicId);
  }

  private state(t: TopicRecord, userId: string): TopicState {
    const s = this.settings.get(`${userId}:${t.id}`);
    const mine = this.events
      .filter((e) => e.topicId === t.id && e.userId === userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const scored = mine.filter((e) => e.score !== null).at(-1);
    const tested = mine.filter((e) => e.kind === "claude_test").at(-1);
    const explainedAt = mine.filter((e) => e.kind === "explanation").at(-1);
    return {
      topic: t,
      importance: s?.importance ?? "medium",
      explanation: s?.explanation ?? "",
      lastScore: scored ? { score: scored.score as Score, at: scored.createdAt } : null,
      lastTestAt: tested?.createdAt ?? null,
      lastExplanation: explainedAt ? { at: explainedAt.createdAt, source: explainedAt.source } : null,
    };
  }
}
