/**
 * The port the core depends on. The core never imports a database library;
 * the Postgres adapter in @prepup/db and the in-memory adapter used in tests
 * both implement this interface.
 */
import type { EventKind, EventSource, Importance, Score, TopicRef } from "@prepup/contracts";
import type { LinkPair } from "./links.js";

export interface TopicRecord {
  id: string;
  workspaceId: string;
  term: string;
  normalizedTerm: string;
  sourceUrl: string | null;
  createdBy: string;
  createdAt: Date;
}

/** One topic plus everything one person's view of it is computed from. */
export interface TopicState {
  topic: TopicRecord;
  importance: Importance;
  explanation: string;
  lastScore: { score: Score; at: Date } | null;
  lastTestAt: Date | null;
  /** The latest explanation change and where it came from. */
  lastExplanation: { at: Date; source: EventSource } | null;
}

export interface NewEvent {
  workspaceId: string;
  topicId: string;
  userId: string;
  kind: EventKind;
  score: Score | null;
  explained: boolean;
  feedback: string | null;
  text: string | null;
  source: EventSource;
  createdAt: Date;
}

export interface EventRecord extends NewEvent {
  id: string;
}

export interface SettingsPatch {
  importance?: Importance;
  explanation?: string;
}

/**
 * One unit of work: a settings change and the events that record it are
 * saved together or not at all, so a score never lands without its
 * explanation (or the other way round).
 */
export interface ChangeSet {
  settings?: { userId: string; topicId: string; patch: SettingsPatch; now: Date };
  events: NewEvent[];
}

/** One "builds on" link: `topicId` builds on `buildsOnId`, both in `workspaceId`. */
export interface TopicLink extends LinkPair {
  workspaceId: string;
  createdBy: string;
  createdAt: Date;
}

/** One topic's neighbours, with the terms to show them by. */
export interface TopicLinks {
  buildsOn: TopicRef[];
  neededFor: TopicRef[];
}

export interface PrepUpRepository {
  /** Returns the user's personal workspace id, creating it on first use. */
  ensurePersonalWorkspace(userId: string, now: Date): Promise<string>;

  /** Inserts the topic unless one with the same normalized term exists; never duplicates, even under races. */
  insertTopicIfAbsent(topic: Omit<TopicRecord, "id">): Promise<{ record: TopicRecord; created: boolean }>;
  findTopicByNormalizedTerm(workspaceId: string, normalizedTerm: string): Promise<TopicRecord | null>;

  countTopics(workspaceId: string): Promise<number>;

  listTopicStates(workspaceId: string, userId: string): Promise<TopicState[]>;
  getTopicState(workspaceId: string, userId: string, topicId: string): Promise<TopicState | null>;

  /** Applies the settings change and appends the events atomically. */
  applyChanges(changes: ChangeSet): Promise<void>;

  /** Deletes the topic with its settings, history and links. Returns false if it isn't in this workspace. */
  deleteTopic(workspaceId: string, topicId: string): Promise<boolean>;

  /** Every topic in the workspace, without scores: cheap, for matching terms and naming topics. */
  listTopicRecords(workspaceId: string): Promise<TopicRecord[]>;

  /**
   * Saves a link unless it already exists; returns whether it was new.
   * `check` is the core's rule (no loops, no more than the cap): the adapter
   * calls it with the workspace's current links and saves only if it doesn't
   * throw, as one unit of work, so two links arriving together can't slip a
   * loop past the check.
   */
  insertLinkIfAbsent(link: TopicLink, check: (existing: LinkPair[]) => void): Promise<boolean>;
  /** Removes a link. Returns false if there was none. */
  deleteLink(workspaceId: string, topicId: string, buildsOnId: string): Promise<boolean>;
  /** One topic's links, both directions. */
  listLinksForTopic(workspaceId: string, topicId: string): Promise<TopicLinks>;
  /** Every link in the workspace, in one query. */
  listLinks(workspaceId: string): Promise<LinkPair[]>;

  /** The user's saved testing style, or null if they never changed the default. */
  getTestingStyle(userId: string): Promise<{ text: string; updatedAt: Date } | null>;
  saveTestingStyle(userId: string, text: string, now: Date): Promise<void>;

  /**
   * "Delete my data": removes the user's personal workspace with every topic in
   * it, plus their settings, events, links and memberships anywhere else.
   */
  deleteUserData(userId: string): Promise<void>;

  listEvents(workspaceId: string, userId: string, topicId: string): Promise<EventRecord[]>;
}
