/**
 * The port the core depends on. The core never imports a database library;
 * the Postgres adapter in @prepup/db and the in-memory adapter used in tests
 * both implement this interface.
 */
import type { EventKind, EventSource, Importance, Score } from "@prepup/contracts";

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

export interface PrepUpRepository {
  /** Returns the user's personal workspace id, creating it on first use. */
  ensurePersonalWorkspace(userId: string, now: Date): Promise<string>;

  /** Inserts the topic unless one with the same normalized term exists; never duplicates, even under races. */
  insertTopicIfAbsent(topic: Omit<TopicRecord, "id">): Promise<{ record: TopicRecord; created: boolean }>;
  findTopicByNormalizedTerm(workspaceId: string, normalizedTerm: string): Promise<TopicRecord | null>;

  listTopicStates(workspaceId: string, userId: string): Promise<TopicState[]>;
  getTopicState(workspaceId: string, userId: string, topicId: string): Promise<TopicState | null>;

  /** Applies the settings change and appends the events atomically. */
  applyChanges(changes: ChangeSet): Promise<void>;

  /** Deletes the topic with its settings and history. Returns false if it isn't in this workspace. */
  deleteTopic(workspaceId: string, topicId: string): Promise<boolean>;

  listEvents(workspaceId: string, userId: string, topicId: string): Promise<EventRecord[]>;
}
