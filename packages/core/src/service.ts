/**
 * The only place PrepUp's rules live. The REST adapter (web app) and the MCP
 * adapter (Claude) both call these methods, so a topic added from an iPhone
 * through Claude and one added in the browser follow identical rules.
 */
import {
  AddTopicInput,
  DEFAULT_MAX_TOPICS,
  ListTopicsInput,
  RecordReviewInput,
  SetScoreInput,
  UpdateTopicInput,
  type EventSource,
  type ReviewEventView,
  type TopicFilter,
  type TopicView,
} from "@prepup/contracts";
import type { z } from "zod";
import { DomainError } from "./errors.js";
import type { NewEvent, PrepUpRepository, TopicState } from "./ports.js";
import { computeScore, levelName, normalizeTerm, priority } from "./scoring.js";

/** Who is acting, and in which workspace. Every call is scoped to this. */
export interface Actor {
  userId: string;
  workspaceId: string;
}

export type Clock = () => Date;

/** Caps the host can tune; they keep one account from filling a shared database. */
export interface Limits {
  maxTopics: number;
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const msg = result.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
    throw new DomainError("invalid", msg.join("; "));
  }
  return result.data;
}

const FILTERS: Record<TopicFilter, (t: TopicView) => boolean> = {
  all: () => true,
  prep: (t) => t.score <= 2,
  fading_week: (t) => t.fadingThisWeek,
  confident: (t) => t.score >= 4,
};

export class PrepUpService {
  constructor(
    private readonly repo: PrepUpRepository,
    private readonly clock: Clock = () => new Date(),
    private readonly limits: Limits = { maxTopics: DEFAULT_MAX_TOPICS },
  ) {}

  async resolveActor(userId: string): Promise<Actor> {
    const workspaceId = await this.repo.ensurePersonalWorkspace(userId, this.clock());
    return { userId, workspaceId };
  }

  /** Idempotent: capturing a term that already exists returns the existing card. */
  async addTopic(actor: Actor, input: unknown) {
    const { term, sourceUrl } = parse(AddTopicInput, input);
    const now = this.clock();
    const normalizedTerm = normalizeTerm(term);
    // The cap only stops new topics: capturing one you already have still returns it.
    const existing = await this.repo.findTopicByNormalizedTerm(actor.workspaceId, normalizedTerm);
    if (!existing && (await this.repo.countTopics(actor.workspaceId)) >= this.limits.maxTopics) {
      throw new DomainError("rule", `Your deck is full (${this.limits.maxTopics} topics). Delete one to add another.`);
    }
    const { record, created } = await this.repo.insertTopicIfAbsent({
      workspaceId: actor.workspaceId,
      term,
      normalizedTerm,
      sourceUrl: sourceUrl ?? null,
      createdBy: actor.userId,
      createdAt: now,
    });
    return { topic: await this.view(actor, record.id), created };
  }

  async listTopics(actor: Actor, input: unknown = {}): Promise<TopicView[]> {
    const { filter, limit } = parse(ListTopicsInput, input);
    const now = this.clock();
    const states = await this.repo.listTopicStates(actor.workspaceId, actor.userId);
    return states
      .map((s) => toView(s, now))
      .filter(FILTERS[filter])
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          (a.daysUntilDrop ?? Infinity) - (b.daysUntilDrop ?? Infinity) ||
          a.term.localeCompare(b.term),
      )
      .slice(0, limit);
  }

  async getTopic(actor: Actor, topicId: string): Promise<TopicView> {
    return this.view(actor, topicId);
  }

  async findByTerm(actor: Actor, term: string): Promise<TopicView> {
    const record = await this.repo.findTopicByNormalizedTerm(actor.workspaceId, normalizeTerm(term));
    if (!record) throw new DomainError("not_found", `No topic called "${term}" in PrepUp`);
    return this.view(actor, record.id);
  }

  /**
   * A Claude test. The only call that resets the fade clock. Claude suggests
   * the score (and optionally a curated explanation); the user confirms both
   * in chat before Claude calls this. Score, explanation and history are
   * saved in one transaction.
   */
  async recordReview(actor: Actor, input: unknown): Promise<TopicView> {
    const { term, score, explained, feedback, answer, explanation } = parse(RecordReviewInput, input);
    if (score === 5 && !explained) {
      throw new DomainError("rule", "A score of 5 requires that the user explained the topic clearly (explained: true)");
    }
    const topic = await this.findByTerm(actor, term);
    const now = this.clock();
    const event = this.event(actor, topic.id, "mcp", now);
    const events: NewEvent[] = [{ ...event, kind: "claude_test", score, explained, feedback, text: answer ?? null }];
    const changesExplanation = explanation !== undefined && explanation !== topic.explanation;
    if (changesExplanation) {
      // One millisecond later, so history lists the explanation right after the test that produced it.
      events.push({ ...event, kind: "explanation", text: explanation, createdAt: new Date(now.getTime() + 1) });
    }
    await this.repo.applyChanges({
      events,
      ...(changesExplanation ? { settings: { userId: actor.userId, topicId: topic.id, patch: { explanation }, now } } : {}),
    });
    return this.view(actor, topic.id);
  }

  /** A manual edit: changes the score you see, but the fade clock keeps running. */
  async setScore(actor: Actor, topicId: string, input: unknown, source: EventSource): Promise<TopicView> {
    const { score } = parse(SetScoreInput, input);
    await this.view(actor, topicId);
    await this.repo.applyChanges({
      events: [{ ...this.event(actor, topicId, source, this.clock()), kind: "manual_edit", score }],
    });
    return this.view(actor, topicId);
  }

  async updateTopic(actor: Actor, topicId: string, input: unknown, source: EventSource): Promise<TopicView> {
    const patch = parse(UpdateTopicInput, input);
    const before = await this.view(actor, topicId);
    const now = this.clock();
    const changesExplanation = patch.explanation !== undefined && patch.explanation !== before.explanation;
    await this.repo.applyChanges({
      settings: { userId: actor.userId, topicId, patch, now },
      events: changesExplanation
        ? [{ ...this.event(actor, topicId, source, now), kind: "explanation", text: patch.explanation! }]
        : [],
    });
    return this.view(actor, topicId);
  }

  /** Permanently removes a topic and its history from the workspace. */
  async deleteTopic(actor: Actor, topicId: string): Promise<{ term: string }> {
    const topic = await this.view(actor, topicId);
    const deleted = await this.repo.deleteTopic(actor.workspaceId, topicId);
    if (!deleted) throw new DomainError("not_found", "Topic not found");
    return { term: topic.term };
  }

  /** "Delete my data": everything PrepUp holds for this user. Signing in again starts an empty deck. */
  async deleteAccount(actor: Actor): Promise<void> {
    await this.repo.deleteUserData(actor.userId);
  }

  async history(actor: Actor, topicId: string): Promise<ReviewEventView[]> {
    await this.view(actor, topicId);
    const events = await this.repo.listEvents(actor.workspaceId, actor.userId, topicId);
    return events
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        score: e.score,
        explained: e.explained,
        feedback: e.feedback,
        text: e.text,
        source: e.source,
        createdAt: e.createdAt.toISOString(),
      }));
  }

  /** The fields every event shares; callers set kind and the specifics. */
  private event(actor: Actor, topicId: string, source: EventSource, at: Date): NewEvent {
    return {
      workspaceId: actor.workspaceId,
      topicId,
      userId: actor.userId,
      kind: "manual_edit",
      score: null,
      explained: false,
      feedback: null,
      text: null,
      source,
      createdAt: at,
    };
  }

  private async view(actor: Actor, topicId: string): Promise<TopicView> {
    const state = await this.repo.getTopicState(actor.workspaceId, actor.userId, topicId);
    if (!state) throw new DomainError("not_found", "Topic not found");
    return toView(state, this.clock());
  }
}

export function toView(s: TopicState, now: Date): TopicView {
  const state = computeScore({
    lastScore: s.lastScore,
    lastTestAt: s.lastTestAt,
    createdAt: s.topic.createdAt,
    now,
  });
  return {
    id: s.topic.id,
    term: s.topic.term,
    sourceUrl: s.topic.sourceUrl,
    importance: s.importance,
    explanation: s.explanation,
    explanationBy: s.lastExplanation ? (s.lastExplanation.source === "mcp" ? "claude" : "you") : null,
    explanationUpdatedAt: s.lastExplanation?.at.toISOString() ?? null,
    score: state.score,
    level: levelName(state.score),
    createdAt: s.topic.createdAt.toISOString(),
    lastTestedAt: s.lastTestAt?.toISOString() ?? null,
    daysUntilDrop: state.daysUntilDrop,
    fadingSoon: state.fadingSoon,
    fadingThisWeek: state.fadingThisWeek,
    priority: priority(s.importance, state),
  };
}
