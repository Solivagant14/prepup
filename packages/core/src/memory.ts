/**
 * An in-memory adapter for the repository port. Used by unit tests and handy
 * for local experiments; behaves like the Postgres adapter.
 */
import { randomUUID } from "node:crypto";
import type { Importance, Score } from "@prepup/contracts";
import type { EventRecord, NewEvent, PrepUpRepository, SettingsPatch, TopicRecord, TopicState } from "./ports.js";

export class InMemoryRepository implements PrepUpRepository {
  private workspaces = new Map<string, string>(); // owner userId -> workspaceId
  private topics: TopicRecord[] = [];
  private settings = new Map<string, { importance: Importance; explanation: string }>();
  private events: EventRecord[] = [];

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

  async listTopicStates(workspaceId: string, userId: string): Promise<TopicState[]> {
    return this.topics.filter((t) => t.workspaceId === workspaceId).map((t) => this.state(t, userId));
  }

  async getTopicState(workspaceId: string, userId: string, topicId: string) {
    const t = this.topics.find((x) => x.id === topicId && x.workspaceId === workspaceId);
    return t ? this.state(t, userId) : null;
  }

  async upsertSettings(userId: string, topicId: string, patch: SettingsPatch) {
    const key = `${userId}:${topicId}`;
    const current = this.settings.get(key) ?? { importance: "medium" as Importance, explanation: "" };
    this.settings.set(key, { ...current, ...patch });
  }

  async deleteTopic(workspaceId: string, topicId: string) {
    const before = this.topics.length;
    this.topics = this.topics.filter((t) => !(t.id === topicId && t.workspaceId === workspaceId));
    if (this.topics.length === before) return false;
    this.events = this.events.filter((e) => e.topicId !== topicId);
    for (const key of this.settings.keys()) if (key.endsWith(`:${topicId}`)) this.settings.delete(key);
    return true;
  }

  async appendEvent(event: NewEvent) {
    this.events.push({ ...event, id: randomUUID() });
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
    return {
      topic: t,
      importance: s?.importance ?? "medium",
      explanation: s?.explanation ?? "",
      lastScore: scored ? { score: scored.score as Score, at: scored.createdAt } : null,
      lastTestAt: tested?.createdAt ?? null,
    };
  }
}
