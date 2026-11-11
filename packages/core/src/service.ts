/**
 * The only place PrepUp's rules live. The REST adapter (web app) and the MCP
 * adapter (Claude) both call these methods, so a topic added from an iPhone
 * through Claude and one added in the browser follow identical rules.
 */
import {
  AddTopicInput,
  DEFAULT_MAX_TOPICS,
  LinkTopicInput,
  LinkTopicsInput,
  ListTopicsInput,
  MAX_PREREQUISITES,
  RecordReviewInput,
  SearchTopicsInput,
  SetScoreInput,
  SIMILAR_TOPICS_LIMIT,
  UpdateSettingsInput,
  UpdateTopicInput,
  type EventSource,
  type HostUsage,
  type ReviewEventView,
  type TopicFilter,
  type TopicRef,
  type TopicView,
  type UserSettingsView,
} from "@prepup/contracts";
import type { z } from "zod";
import { DomainError } from "./errors.js";
import { loopPath, prerequisitesFirst, type LinkPair } from "./links.js";
import { bestMatches } from "./matching.js";
import type { NewEvent, PrepUpRepository, TopicLinks, TopicState } from "./ports.js";
import { computeScore, levelName, normalizeTerm, priority } from "./scoring.js";
import { DEFAULT_TESTING_STYLE, presetOf } from "./testing.js";

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

/** The shortest overlap that makes two terms "similar": below this, nearly everything matches. */
const SIMILAR_MIN_LENGTH = 3;

const byTerm = (a: TopicRef, b: TopicRef) => a.term.localeCompare(b.term);
const NO_LINKS: TopicLinks = { buildsOn: [], neededFor: [] };

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

  /**
   * Idempotent: capturing a term that already exists returns the existing card.
   * `similar` lists existing topics whose terms look alike, so Claude can
   * propose "builds on" links from them. Nothing is linked here.
   */
  async addTopic(actor: Actor, input: unknown): Promise<{ topic: TopicView; created: boolean; similar: TopicRef[] }> {
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
    const others = (await this.repo.listTopicRecords(actor.workspaceId)).filter((t) => t.id !== record.id);
    const similar = bestMatches(record.term, others, SIMILAR_TOPICS_LIMIT, SIMILAR_MIN_LENGTH);
    return {
      topic: await this.view(actor, record.id),
      created,
      similar: similar.map((t) => ({ id: t.id, term: t.term })),
    };
  }

  /**
   * Highest priority first. With the "prep" filter, a topic's prerequisites
   * come ahead of it, so the list reads as a path: learn what it builds on,
   * then the topic. Other filters keep plain priority order.
   */
  async listTopics(actor: Actor, input: unknown = {}): Promise<TopicView[]> {
    const { filter, limit } = parse(ListTopicsInput, input);
    const { views, links } = await this.allViews(actor);
    const shown = views.filter(FILTERS[filter]);
    return (filter === "prep" ? prerequisitesFirst(shown, links) : shown).slice(0, limit);
  }

  /** Finds topics by text, for decks too big to list. Best match first. */
  async searchTopics(actor: Actor, input: unknown): Promise<TopicView[]> {
    const { query, limit } = parse(SearchTopicsInput, input);
    const { views } = await this.allViews(actor);
    return bestMatches(query, views, limit, 1);
  }

  async getTopic(actor: Actor, topicId: string): Promise<TopicView> {
    return this.view(actor, topicId);
  }

  async findByTerm(actor: Actor, term: string): Promise<TopicView> {
    return this.view(actor, (await this.recordByTerm(actor, term)).id);
  }

  private async recordByTerm(actor: Actor, term: string) {
    const record = await this.repo.findTopicByNormalizedTerm(actor.workspaceId, normalizeTerm(term));
    if (!record) throw new DomainError("not_found", `No topic called "${term}" in PrepUp`);
    return record;
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

  /**
   * Records that one topic builds on another. Linking twice changes nothing.
   * Links are a map of the deck and nothing more: they never change a score
   * or the fade clock. Both topics must be in the actor's workspace.
   */
  async linkTopics(actor: Actor, topicId: string, input: unknown): Promise<{ topic: TopicView; created: boolean }> {
    const { buildsOnId } = parse(LinkTopicInput, input);
    const [topic, prerequisite] = await Promise.all([this.state(actor, topicId), this.state(actor, buildsOnId)]);
    if (topicId === buildsOnId) {
      throw new DomainError("rule", `"${topic.topic.term}" can't build on itself.`);
    }
    const created = await this.repo.insertLinkIfAbsent(
      { workspaceId: actor.workspaceId, topicId, buildsOnId, createdBy: actor.userId, createdAt: this.clock() },
      (existing) => this.checkLink(existing, topic.topic.term, prerequisite.topic.term, topicId, buildsOnId),
    );
    return { topic: await this.view(actor, topicId), created };
  }

  /** Removes a "builds on" link. Removing one that isn't there changes nothing. */
  async unlinkTopics(actor: Actor, topicId: string, buildsOnId: string): Promise<{ topic: TopicView; removed: boolean }> {
    await Promise.all([this.state(actor, topicId), this.state(actor, buildsOnId)]);
    const removed = await this.repo.deleteLink(actor.workspaceId, topicId, buildsOnId);
    return { topic: await this.view(actor, topicId), removed };
  }

  /** The same two calls by term, as Claude makes them. */
  async linkTopicsByTerm(actor: Actor, input: unknown) {
    const { term, buildsOnTerm } = parse(LinkTopicsInput, input);
    const [topic, prerequisite] = [await this.recordByTerm(actor, term), await this.recordByTerm(actor, buildsOnTerm)];
    const result = await this.linkTopics(actor, topic.id, { buildsOnId: prerequisite.id });
    return { ...result, buildsOn: { id: prerequisite.id, term: prerequisite.term } };
  }

  async unlinkTopicsByTerm(actor: Actor, input: unknown) {
    const { term, buildsOnTerm } = parse(LinkTopicsInput, input);
    const [topic, prerequisite] = [await this.recordByTerm(actor, term), await this.recordByTerm(actor, buildsOnTerm)];
    const result = await this.unlinkTopics(actor, topic.id, prerequisite.id);
    return { ...result, buildsOn: { id: prerequisite.id, term: prerequisite.term } };
  }

  /** The rules a new link must pass, given every link the workspace already has. */
  private checkLink(existing: LinkPair[], term: string, buildsOnTerm: string, topicId: string, buildsOnId: string) {
    if (existing.filter((l) => l.topicId === topicId).length >= MAX_PREREQUISITES) {
      throw new DomainError(
        "rule",
        `"${term}" already builds on ${MAX_PREREQUISITES} topics, which is the most a topic can have. Remove one to add another.`,
      );
    }
    const loop = loopPath(existing, topicId, buildsOnId);
    if (loop) {
      const how = loop.length > 2 ? ` (through ${loop.length - 2 === 1 ? "another topic" : `${loop.length - 2} other topics`})` : "";
      throw new DomainError(
        "rule",
        `"${term}" can't build on "${buildsOnTerm}": "${buildsOnTerm}" already builds on "${term}"${how}, so this would make a loop.`,
      );
    }
  }

  /** Permanently removes a topic, its history and its links from the workspace. */
  async deleteTopic(actor: Actor, topicId: string): Promise<{ term: string }> {
    const topic = await this.view(actor, topicId);
    const deleted = await this.repo.deleteTopic(actor.workspaceId, topicId);
    if (!deleted) throw new DomainError("not_found", "Topic not found");
    return { term: topic.term };
  }

  /** Personal settings. Until the user saves a style of their own, they get the default preset. */
  async getSettings(actor: Actor): Promise<UserSettingsView> {
    const saved = await this.repo.getTestingStyle(actor.userId);
    const testingStyle = saved?.text ?? DEFAULT_TESTING_STYLE;
    return { testingStyle, preset: presetOf(testingStyle), updatedAt: saved?.updatedAt.toISOString() ?? null };
  }

  async updateSettings(actor: Actor, input: unknown): Promise<UserSettingsView> {
    const { testingStyle } = parse(UpdateSettingsInput, input);
    await this.repo.saveTestingStyle(actor.userId, testingStyle, this.clock());
    return this.getSettings(actor);
  }

  /** "Delete my data": everything PrepUp holds for this user. Signing in again starts an empty deck. */
  async deleteAccount(actor: Actor): Promise<void> {
    await this.repo.deleteUserData(actor.userId);
  }

  /** How full the shared host is. Public and anonymous: counts only, no actor. */
  async hostUsage(): Promise<HostUsage> {
    return this.repo.hostUsage();
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

  private async state(actor: Actor, topicId: string): Promise<TopicState> {
    const state = await this.repo.getTopicState(actor.workspaceId, actor.userId, topicId);
    if (!state) throw new DomainError("not_found", "Topic not found");
    return state;
  }

  private async view(actor: Actor, topicId: string): Promise<TopicView> {
    const [state, links] = await Promise.all([
      this.state(actor, topicId),
      this.repo.listLinksForTopic(actor.workspaceId, topicId),
    ]);
    return toView(state, this.clock(), links);
  }

  /** Every topic in priority order, with its links filled in from one links query. */
  private async allViews(actor: Actor): Promise<{ views: TopicView[]; links: LinkPair[] }> {
    const now = this.clock();
    const [states, links] = await Promise.all([
      this.repo.listTopicStates(actor.workspaceId, actor.userId),
      this.repo.listLinks(actor.workspaceId),
    ]);
    const term = new Map(states.map((s) => [s.topic.id, s.topic.term]));
    const neighbours = new Map<string, TopicLinks>(states.map((s) => [s.topic.id, { buildsOn: [], neededFor: [] }]));
    for (const l of links) {
      const [topic, prerequisite] = [term.get(l.topicId), term.get(l.buildsOnId)];
      if (topic === undefined || prerequisite === undefined) continue;
      neighbours.get(l.topicId)!.buildsOn.push({ id: l.buildsOnId, term: prerequisite });
      neighbours.get(l.buildsOnId)!.neededFor.push({ id: l.topicId, term: topic });
    }
    const views = states
      .map((s) => toView(s, now, neighbours.get(s.topic.id)))
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          (a.daysUntilDrop ?? Infinity) - (b.daysUntilDrop ?? Infinity) ||
          a.term.localeCompare(b.term),
      );
    return { views, links };
  }
}

export function toView(s: TopicState, now: Date, links: TopicLinks = NO_LINKS): TopicView {
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
    buildsOn: [...links.buildsOn].sort(byTerm),
    neededFor: [...links.neededFor].sort(byTerm),
  };
}
