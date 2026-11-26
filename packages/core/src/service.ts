/**
 * The only place PrepUp's rules live. The REST adapter (web app) and the MCP
 * adapter (Claude) both call these methods, so a topic added from an iPhone
 * through Claude and one added in the browser follow identical rules.
 */
import {
  AddTopicInput,
  CreateDeckInput,
  DEFAULT_DECK_NAME,
  DEFAULT_MAX_TOPICS,
  DeleteDeckInput,
  DeleteTopicInput,
  LinkTopicInput,
  LinkTopicsInput,
  ListTopicsInput,
  MarkTopicsLinkedInput,
  MAX_DECKS,
  MAX_PREREQUISITES,
  MoveTopicByNameInput,
  MoveTopicInput,
  RecordReviewInput,
  RenameDeckByNameInput,
  RenameDeckInput,
  SearchTopicsInput,
  SetScoreInput,
  SIMILAR_TOPICS_LIMIT,
  UpdateSettingsInput,
  UpdateTopicInput,
  nextUnderstanding,
  UNDERSTANDING_LEVELS,
  type DeckRef,
  type DeckView,
  type EventSource,
  type HostUsage,
  type ReviewEventView,
  type TopicFilter,
  type TopicRef,
  type TopicView,
  type Understanding,
  type UserSettingsView,
} from "@prepup/contracts";
import type { z } from "zod";
import { DomainError } from "./errors.js";
import { loopPath, prerequisitesFirst, type LinkPair } from "./links.js";
import { bestMatches } from "./matching.js";
import type { DeckRecord, NewEvent, PrepUpRepository, TopicLinks, TopicRecord, TopicState } from "./ports.js";
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
  needs_links: (t) => t.needsLinks,
};

/** The shortest overlap that makes two terms "similar": below this, nearly everything matches. */
const SIMILAR_MIN_LENGTH = 3;

const byTerm = (a: TopicRef, b: TopicRef) => a.term.localeCompare(b.term);
const deckList = (decks: { name: string }[]) => decks.map((d) => `"${d.name}"`).join(", ");
/** Oldest first; decks made in the same instant keep the order they were saved in. */
const byCreated = (a: DeckRecord, b: DeckRecord) => a.createdAt.getTime() - b.createdAt.getTime();
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
    const { term, sourceUrl, deck: deckName, deckId } = parse(AddTopicInput, input);
    const now = this.clock();
    const normalizedTerm = normalizeTerm(term);
    const deck = await this.targetDeck(actor, deckName, deckId);
    // The cap only stops new topics: capturing one you already have still returns it.
    const existing = (await this.repo.findTopicsByNormalizedTerm(actor.workspaceId, normalizedTerm)).find(
      (t) => t.deckId === deck.id,
    );
    if (!existing && (await this.repo.countTopics(actor.workspaceId)) >= this.limits.maxTopics) {
      throw new DomainError("rule", `You have ${this.limits.maxTopics} topics, the most PrepUp allows. Delete one to add another.`);
    }
    const { record, created } = await this.repo.insertTopicIfAbsent({
      workspaceId: actor.workspaceId,
      deckId: deck.id,
      term,
      normalizedTerm,
      sourceUrl: sourceUrl ?? null,
      createdBy: actor.userId,
      createdAt: now,
      linksCheckedAt: null,
    });
    // Links stay inside one deck, so only this deck's topics are worth proposing.
    const others = (await this.repo.listTopicRecords(actor.workspaceId)).filter(
      (t) => t.id !== record.id && t.deckId === record.deckId,
    );
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
    const { filter, limit, deck, deckId } = parse(ListTopicsInput, input);
    const only = await this.deckFilter(actor, deck, deckId);
    const { views, links } = await this.allViews(actor);
    const shown = views.filter((v) => (!only || v.deck.id === only.id) && FILTERS[filter](v));
    return (filter === "prep" ? prerequisitesFirst(shown, links) : shown).slice(0, limit);
  }

  /** Finds topics by text, for decks too big to list. Best match first. */
  async searchTopics(actor: Actor, input: unknown): Promise<TopicView[]> {
    const { query, limit, deck } = parse(SearchTopicsInput, input);
    const only = await this.deckFilter(actor, deck);
    const { views } = await this.allViews(actor);
    return bestMatches(
      query,
      views.filter((v) => !only || v.deck.id === only.id),
      limit,
      1,
    );
  }

  async getTopic(actor: Actor, topicId: string): Promise<TopicView> {
    return this.view(actor, topicId);
  }

  /** A topic by its term, as an assistant names it. `deck` (a name) picks one when the term is in several decks. */
  async findByTerm(actor: Actor, term: string, deck?: string): Promise<TopicView> {
    return this.view(actor, (await this.recordByTerm(actor, term, deck)).id);
  }

  private async recordByTerm(actor: Actor, term: string, deckName?: string): Promise<TopicRecord> {
    const deck = deckName === undefined ? undefined : await this.deckByName(actor, deckName);
    const found = (await this.repo.findTopicsByNormalizedTerm(actor.workspaceId, normalizeTerm(term))).filter(
      (t) => !deck || t.deckId === deck.id,
    );
    if (found.length === 0) {
      throw new DomainError("not_found", deck ? `No topic called "${term}" in the deck "${deck.name}"` : `No topic called "${term}" in PrepUp`);
    }
    if (found.length > 1) {
      const decks = (await this.repo.listDecks(actor.workspaceId)).filter((d) => found.some((t) => t.deckId === d.id));
      throw new DomainError(
        "rule",
        `"${term}" is in ${found.length} decks: ${deckList(decks)}. Ask the user which deck they mean, then pass it as deck.`,
      );
    }
    return found[0]!;
  }

  /** The prerequisite of a link named by terms: it must be in the same deck as the topic. */
  private async prerequisiteByTerm(actor: Actor, term: string, deckId: string): Promise<TopicRecord> {
    const found = await this.repo.findTopicsByNormalizedTerm(actor.workspaceId, normalizeTerm(term));
    const same = found.find((t) => t.deckId === deckId);
    if (same) return same;
    const deck = (await this.repo.listDecks(actor.workspaceId)).find((d) => d.id === deckId);
    if (found.length > 0) {
      throw new DomainError("rule", `"${term}" isn't in the deck "${deck?.name}". Links stay inside one deck.`);
    }
    throw new DomainError("not_found", `No topic called "${term}" in PrepUp`);
  }

  /**
   * A Claude test. The only call that resets the fade clock. Claude suggests
   * the score (and optionally a curated explanation); the user confirms both
   * in chat before Claude calls this. Score, explanation and history are
   * saved in one transaction.
   */
  async recordReview(actor: Actor, input: unknown): Promise<TopicView> {
    const { term, deck, score, explained, feedback, answer, explanation } = parse(RecordReviewInput, input);
    if (score === 5 && !explained) {
      throw new DomainError("rule", "A score of 5 requires that the user explained the topic clearly (explained: true)");
    }
    const topic = await this.findByTerm(actor, term, deck);
    const now = this.clock();
    const event = this.event(actor, topic.id, "mcp", now);
    // The test is at the topic's current level, and its score is that level's.
    const events: NewEvent[] = [
      { ...event, kind: "claude_test", score, understanding: topic.understanding, explained, feedback, text: answer ?? null },
    ];
    const changesExplanation = explanation !== undefined && explanation !== topic.explanation;
    if (changesExplanation) {
      // One millisecond later, so history lists the explanation right after the test that produced it.
      events.push({ ...event, kind: "explanation", text: explanation, createdAt: new Date(now.getTime() + 1) });
    }
    // A 5 at one level moves the topic up to the next, where it starts at 0.
    const movesUp = score === 5 ? nextUnderstanding(topic.understanding) : null;
    const patch = { ...(changesExplanation ? { explanation } : {}), ...(movesUp ? { understanding: movesUp } : {}) };
    await this.repo.applyChanges({
      events,
      ...(Object.keys(patch).length ? { settings: { userId: actor.userId, topicId: topic.id, patch, now } } : {}),
    });
    return this.view(actor, topic.id);
  }

  /**
   * A manual edit of the score at the topic's current level: changes the score
   * you see, but the fade clock keeps running, and it never moves the level.
   */
  async setScore(actor: Actor, topicId: string, input: unknown, source: EventSource): Promise<TopicView> {
    const { score } = parse(SetScoreInput, input);
    const topic = await this.view(actor, topicId);
    await this.repo.applyChanges({
      events: [
        { ...this.event(actor, topicId, source, this.clock()), kind: "manual_edit", score, understanding: topic.understanding },
      ],
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
    if (topic.topic.deckId !== prerequisite.topic.deckId) {
      throw new DomainError(
        "rule",
        `"${topic.topic.term}" and "${prerequisite.topic.term}" are in different decks. Links stay inside one deck.`,
      );
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
    const { term, buildsOnTerm, deck } = parse(LinkTopicsInput, input);
    const topic = await this.recordByTerm(actor, term, deck);
    const prerequisite = await this.prerequisiteByTerm(actor, buildsOnTerm, topic.deckId);
    const result = await this.linkTopics(actor, topic.id, { buildsOnId: prerequisite.id });
    // An assistant naming a prerequisite has checked this topic's links.
    await this.repo.markLinksChecked(actor.workspaceId, [topic.id], this.clock());
    return { ...result, topic: await this.view(actor, topic.id), buildsOn: { id: prerequisite.id, term: prerequisite.term } };
  }

  /**
   * Records that an assistant checked what these topics build on, whether or
   * not it found anything to link, so they drop out of the needs_links list.
   */
  async markTopicsLinked(actor: Actor, input: unknown): Promise<{ terms: string[] }> {
    const { terms, deck } = parse(MarkTopicsLinkedInput, input);
    const records: TopicRecord[] = [];
    for (const term of terms) records.push(await this.recordByTerm(actor, term, deck));
    await this.repo.markLinksChecked(
      actor.workspaceId,
      records.map((r) => r.id),
      this.clock(),
    );
    return { terms: records.map((r) => r.term) };
  }

  async unlinkTopicsByTerm(actor: Actor, input: unknown) {
    const { term, buildsOnTerm, deck } = parse(LinkTopicsInput, input);
    const topic = await this.recordByTerm(actor, term, deck);
    const prerequisite = await this.prerequisiteByTerm(actor, buildsOnTerm, topic.deckId);
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

  /** The same delete by term, as an assistant makes it. It needs the user's confirmation, passed as `confirmed: true`. */
  async deleteTopicByTerm(actor: Actor, input: unknown): Promise<{ term: string }> {
    const { term, deck } = parse(DeleteTopicInput, input);
    return this.deleteTopic(actor, (await this.recordByTerm(actor, term, deck)).id);
  }

  /**
   * Moves a topic to another deck. Its score, history and explanation go with
   * it; its links are removed, because links stay inside one deck.
   */
  async moveTopic(actor: Actor, topicId: string, input: unknown): Promise<{ topic: TopicView; from: DeckRef; removedLinks: number }> {
    const { deckId } = parse(MoveTopicInput, input);
    const before = await this.view(actor, topicId);
    const to = await this.deckById(actor, deckId);
    if (before.deck.id === to.id) return { topic: before, from: before.deck, removedLinks: 0 };
    const clash = (await this.repo.findTopicsByNormalizedTerm(actor.workspaceId, normalizeTerm(before.term))).some(
      (t) => t.deckId === to.id,
    );
    if (clash) {
      throw new DomainError("rule", `The deck "${to.name}" already has "${before.term}". Delete one of them, or rename the deck.`);
    }
    if (!(await this.repo.moveTopic(actor.workspaceId, topicId, to.id))) throw new DomainError("not_found", "Topic not found");
    return {
      topic: await this.view(actor, topicId),
      from: before.deck,
      removedLinks: before.buildsOn.length + before.neededFor.length,
    };
  }

  /** The same move by names, as an assistant asks. */
  async moveTopicByName(actor: Actor, input: unknown) {
    const { term, deck, toDeck } = parse(MoveTopicByNameInput, input);
    const topic = await this.recordByTerm(actor, term, deck);
    const to = await this.deckByName(actor, toDeck);
    return this.moveTopic(actor, topic.id, { deckId: to.id });
  }

  /** Every deck, oldest first, with how many topics each holds. Someone with no deck yet gets the default one. */
  async listDecks(actor: Actor): Promise<DeckView[]> {
    const decks = await this.decksOf(actor);
    const topics = await this.repo.listTopicRecords(actor.workspaceId);
    return decks.map((d) => deckView(d, topics.filter((t) => t.deckId === d.id).length));
  }

  /** Idempotent: creating a deck that already exists (even spelled differently) returns it. */
  async createDeck(actor: Actor, input: unknown): Promise<{ deck: DeckView; created: boolean }> {
    const { name } = parse(CreateDeckInput, input);
    const normalizedName = normalizeTerm(name);
    const decks = await this.repo.listDecks(actor.workspaceId);
    const existing = decks.find((d) => d.normalizedName === normalizedName);
    if (!existing && decks.length >= MAX_DECKS) {
      throw new DomainError("rule", `You have the most decks PrepUp allows (${MAX_DECKS}). Delete one to add another.`);
    }
    const { record, created } = await this.repo.insertDeckIfAbsent({
      workspaceId: actor.workspaceId,
      name,
      normalizedName,
      createdBy: actor.userId,
      createdAt: this.clock(),
    });
    return { deck: await this.deckViewOf(actor, record), created };
  }

  async renameDeck(actor: Actor, deckId: string, input: unknown): Promise<DeckView> {
    const { name } = parse(RenameDeckInput, input);
    const deck = await this.deckById(actor, deckId);
    const normalizedName = normalizeTerm(name);
    const taken = (await this.repo.listDecks(actor.workspaceId)).find((d) => d.normalizedName === normalizedName && d.id !== deck.id);
    if (taken) throw new DomainError("rule", `You already have a deck called "${taken.name}".`);
    if (!(await this.repo.renameDeck(actor.workspaceId, deck.id, name, normalizedName))) {
      throw new DomainError("not_found", "Deck not found");
    }
    return this.deckViewOf(actor, { ...deck, name, normalizedName });
  }

  async renameDeckByName(actor: Actor, input: unknown): Promise<{ from: string; deck: DeckView }> {
    const { deck, newName } = parse(RenameDeckByNameInput, input);
    const current = await this.deckByName(actor, deck);
    return { from: current.name, deck: await this.renameDeck(actor, current.id, { name: newName }) };
  }

  /** Permanently deletes a deck and every topic in it, with their history and links. */
  async deleteDeck(actor: Actor, deckId: string): Promise<{ name: string; topicCount: number }> {
    const deck = await this.deckViewOf(actor, await this.deckById(actor, deckId));
    if (!(await this.repo.deleteDeck(actor.workspaceId, deck.id))) throw new DomainError("not_found", "Deck not found");
    return { name: deck.name, topicCount: deck.topicCount };
  }

  /** The same delete by name, as an assistant makes it. It needs the user's confirmation, passed as `confirmed: true`. */
  async deleteDeckByName(actor: Actor, input: unknown): Promise<{ name: string; topicCount: number }> {
    const { deck } = parse(DeleteDeckInput, input);
    return this.deleteDeck(actor, (await this.deckByName(actor, deck)).id);
  }

  /** The workspace's decks, oldest first. Creates the default deck for someone who has none, so there is always one to add to. */
  private async decksOf(actor: Actor): Promise<DeckRecord[]> {
    const decks = await this.repo.listDecks(actor.workspaceId);
    if (decks.length > 0) return decks.sort(byCreated);
    const { record } = await this.repo.insertDeckIfAbsent({
      workspaceId: actor.workspaceId,
      name: DEFAULT_DECK_NAME,
      normalizedName: normalizeTerm(DEFAULT_DECK_NAME),
      createdBy: actor.userId,
      createdAt: this.clock(),
    });
    return [record];
  }

  private async deckById(actor: Actor, deckId: string): Promise<DeckRecord> {
    const deck = (await this.repo.listDecks(actor.workspaceId)).find((d) => d.id === deckId);
    if (!deck) throw new DomainError("not_found", "Deck not found");
    return deck;
  }

  private async deckByName(actor: Actor, name: string): Promise<DeckRecord> {
    const decks = await this.decksOf(actor);
    const deck = decks.find((d) => d.normalizedName === normalizeTerm(name));
    if (!deck) throw new DomainError("not_found", `No deck called "${name}". The user's decks: ${deckList(decks)}.`);
    return deck;
  }

  /** Which deck a list or search is limited to, if any. */
  private async deckFilter(actor: Actor, name?: string, id?: string): Promise<DeckRecord | undefined> {
    if (id !== undefined) return this.deckById(actor, id);
    if (name !== undefined) return this.deckByName(actor, name);
    return undefined;
  }

  /** Where a new topic goes: the deck named, or the only deck. With several decks and none named, the assistant must ask. */
  private async targetDeck(actor: Actor, name?: string, id?: string): Promise<DeckRecord> {
    const chosen = await this.deckFilter(actor, name, id);
    if (chosen) return chosen;
    const decks = await this.decksOf(actor);
    if (decks.length === 1) return decks[0]!;
    throw new DomainError(
      "rule",
      `The user has ${decks.length} decks: ${deckList(decks)}. Ask which deck to add it to, then pass it as deck.`,
    );
  }

  private async deckViewOf(actor: Actor, deck: DeckRecord): Promise<DeckView> {
    const topics = await this.repo.listTopicRecords(actor.workspaceId);
    return deckView(deck, topics.filter((t) => t.deckId === deck.id).length);
  }

  /** Personal settings. Until the user saves a style of their own, they get the default preset. */
  async getSettings(actor: Actor): Promise<UserSettingsView> {
    const [saved, autoLink] = await Promise.all([
      this.repo.getTestingStyle(actor.userId),
      this.repo.getAutoLink(actor.userId),
    ]);
    const testingStyle = saved?.text ?? DEFAULT_TESTING_STYLE;
    return { testingStyle, preset: presetOf(testingStyle), autoLink, updatedAt: saved?.updatedAt.toISOString() ?? null };
  }

  async updateSettings(actor: Actor, input: unknown): Promise<UserSettingsView> {
    const { testingStyle, autoLink } = parse(UpdateSettingsInput, input);
    if (testingStyle !== undefined) await this.repo.saveTestingStyle(actor.userId, testingStyle, this.clock());
    if (autoLink !== undefined) await this.repo.saveAutoLink(actor.userId, autoLink, this.clock());
    return this.getSettings(actor);
  }

  /** Whether the user lets their assistant link new topics without asking. Off unless they turned it on. */
  async autoLink(actor: Actor): Promise<boolean> {
    return this.repo.getAutoLink(actor.userId);
  }

  /** "Erase all my data": everything PrepUp holds for this user. Signing in again starts an empty deck. */
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
        understanding: e.understanding,
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
      understanding: null,
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
    const [state, links, decks] = await Promise.all([
      this.state(actor, topicId),
      this.repo.listLinksForTopic(actor.workspaceId, topicId),
      this.repo.listDecks(actor.workspaceId),
    ]);
    return toView(state, this.clock(), links, deckRefOf(decks, state.topic.deckId));
  }

  /** Every topic in priority order, with its links filled in from one links query. */
  private async allViews(actor: Actor): Promise<{ views: TopicView[]; links: LinkPair[] }> {
    const now = this.clock();
    const [states, links, decks] = await Promise.all([
      this.repo.listTopicStates(actor.workspaceId, actor.userId),
      this.repo.listLinks(actor.workspaceId),
      this.repo.listDecks(actor.workspaceId),
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
      .map((s) => toView(s, now, neighbours.get(s.topic.id), deckRefOf(decks, s.topic.deckId)))
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          (a.daysUntilDrop ?? Infinity) - (b.daysUntilDrop ?? Infinity) ||
          a.term.localeCompare(b.term),
      );
    return { views, links };
  }
}

function deckView(d: DeckRecord, topicCount: number): DeckView {
  return { id: d.id, name: d.name, topicCount, createdAt: d.createdAt.toISOString() };
}

function deckRefOf(decks: DeckRecord[], deckId: string): DeckRef {
  const deck = decks.find((d) => d.id === deckId);
  return { id: deckId, name: deck?.name ?? DEFAULT_DECK_NAME };
}

export function toView(
  s: TopicState,
  now: Date,
  links: TopicLinks = NO_LINKS,
  deck: DeckRef = { id: s.topic.deckId, name: DEFAULT_DECK_NAME },
): TopicView {
  // Each level keeps its own score and fade clock; the topic shows its current level's.
  const at = (level: Understanding) =>
    computeScore({
      lastScore: s.levels[level].lastScore,
      lastTestAt: s.levels[level].lastTestAt,
      createdAt: s.topic.createdAt,
      now,
    });
  const state = at(s.understanding);
  return {
    id: s.topic.id,
    term: s.topic.term,
    deck,
    sourceUrl: s.topic.sourceUrl,
    importance: s.importance,
    explanation: s.explanation,
    explanationBy: s.lastExplanation ? (s.lastExplanation.source === "mcp" ? "claude" : "you") : null,
    explanationUpdatedAt: s.lastExplanation?.at.toISOString() ?? null,
    understanding: s.understanding,
    score: state.score,
    level: levelName(state.score),
    levels: UNDERSTANDING_LEVELS.map((l) => ({ understanding: l, score: l === s.understanding ? state.score : at(l).score })),
    createdAt: s.topic.createdAt.toISOString(),
    lastTestedAt: s.levels[s.understanding].lastTestAt?.toISOString() ?? null,
    daysUntilDrop: state.daysUntilDrop,
    fadingSoon: state.fadingSoon,
    fadingThisWeek: state.fadingThisWeek,
    priority: priority(s.importance, state),
    buildsOn: [...links.buildsOn].sort(byTerm),
    neededFor: [...links.neededFor].sort(byTerm),
    needsLinks: s.topic.linksCheckedAt === null,
  };
}
