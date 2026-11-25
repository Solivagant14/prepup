/**
 * One contract, three uses: these Zod schemas validate web requests, REST
 * bodies and MCP tool inputs, so "what a topic is" is defined exactly once.
 */
import { z } from "zod";

export const IMPORTANCE = ["high", "medium", "low"] as const;
export const Importance = z.enum(IMPORTANCE);
export type Importance = z.infer<typeof Importance>;

/** 1–4 = how well you understand it and answer questions; 5 = you can explain it clearly. */
export const Score = z.number().int().min(1).max(5);
export type Score = z.infer<typeof Score>;

export const LEVEL_NAMES = ["Shaky", "Learning", "Getting there", "Confident", "Can explain"] as const;

/**
 * A topic that has never been tested or scored shows 0, and you can set a
 * topic back to 0 yourself. A test always records 1–5, and a score never
 * fades below 1 (a 0 doesn't fade).
 */
export const UNTESTED_SCORE = 0;
export const UNTESTED_LEVEL = "Not tested yet";
/** The score a topic shows: 0 (never scored, or set to 0 by you) or 1–5. */
export type ShownScore = typeof UNTESTED_SCORE | Score;
/** A score you set yourself: 0 resets the topic to "Not tested yet". */
export const ManualScore = z.number().int().min(0).max(5);
export type LevelName = (typeof LEVEL_NAMES)[number] | typeof UNTESTED_LEVEL;

/** How many topics one workspace may hold unless the host sets another cap. Matches the largest list page. */
export const DEFAULT_MAX_TOPICS = 500;

/** How many decks one person may have. */
export const MAX_DECKS = 50;

/** The deck existing topics move into, and the one created when someone adds a topic before making a deck. */
export const DEFAULT_DECK_NAME = "My deck";

/** How many topics one topic may build on directly. Keeps a card readable and the loop check cheap. */
export const MAX_PREREQUISITES = 20;

/** How many look-alike topics a capture returns, for Claude to propose links from. */
export const SIMILAR_TOPICS_LIMIT = 5;

export const TOPIC_FILTERS = ["all", "prep", "fading_week", "confident"] as const;
export const TopicFilter = z.enum(TOPIC_FILTERS);
export type TopicFilter = z.infer<typeof TopicFilter>;

/** Social sign-in providers the login screens can offer (each must also be enabled in Supabase). */
export const OAUTH_PROVIDERS = ["google", "github"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const EVENT_KINDS = ["claude_test", "manual_edit", "explanation"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_SOURCES = ["web", "mcp"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

const Term = z
  .string()
  .trim()
  .min(1, "Term cannot be empty")
  .max(80, "Keep terms under 80 characters");

const OptionalUrl = z.url({ protocol: /^https?$/ }).max(2048).optional();

const DeckName = z
  .string()
  .trim()
  .min(1, "Deck name cannot be empty")
  .max(60, "Keep deck names under 60 characters");

/** Which deck a topic is in, by name, as an assistant says it. Optional when the user has one deck, or the term is in one deck only. */
const InDeck = DeckName.optional().describe(
  "The deck's name, e.g. 'DSA'. Leave it out when the user has one deck or the topic is in only one deck",
);

export const AddTopicInput = z.object({
  term: Term.describe("The term or concept, e.g. 'RAG' or 'speculative decoding'"),
  sourceUrl: OptionalUrl.describe("Where you heard it, e.g. a YouTube link"),
  deck: DeckName.optional().describe(
    "Which deck to add it to, by name, e.g. 'DSA'. Required when the user has more than one deck: ask them if they haven't said",
  ),
  /** The web app names the deck by id. */
  deckId: z.uuid().optional(),
});
export type AddTopicInput = z.infer<typeof AddTopicInput>;

export const ListTopicsInput = z.object({
  filter: TopicFilter.default("all").describe(
    "all = every topic; prep = weakest and untested topics (score 0-2), most important first, with prerequisites ahead of what builds on them; fading_week = drops within 7 days; confident = score 4+",
  ),
  limit: z.number().int().min(1).max(500).default(20),
  deck: DeckName.optional().describe("Only topics in this deck, by name. Leave it out for every deck"),
  deckId: z.uuid().optional(),
});
export type ListTopicsInput = z.input<typeof ListTopicsInput>;

export const RecordReviewInput = z.object({
  term: Term.describe("The topic that was tested, as it appears in PrepUp"),
  deck: InDeck,
  score: Score.describe("The score the user confirmed, 1–5"),
  explained: z
    .boolean()
    .default(false)
    .describe("True only if the user explained the topic clearly in their own words; required for a score of 5"),
  feedback: z.string().trim().min(1).max(1000).describe("One or two lines on why this score"),
  answer: z.string().trim().max(4000).optional().describe("The user's answer, for their history"),
  explanation: z
    .string()
    .trim()
    .min(1)
    .max(1500)
    .optional()
    .describe(
      "Optional, only if the user approved it: their explanation of the topic in their own voice, 2-4 sentences, drawn from their answers and any corrections they accepted. It replaces their saved explanation, so keep the correct points from it (read it with get_topic).",
    ),
});
export type RecordReviewInput = z.input<typeof RecordReviewInput>;

export const GetTopicInput = z.object({
  term: Term.describe("The topic to read, as it appears in PrepUp"),
  deck: InDeck,
});
export type GetTopicInput = z.infer<typeof GetTopicInput>;

/**
 * Deleting a topic by term, as an assistant asks. `confirmed` must be the literal
 * `true`: the assistant states that the user asked for this and said yes in chat.
 */
export const DeleteTopicInput = z.object({
  term: Term.describe("The topic to delete, as it appears in PrepUp"),
  deck: InDeck,
  confirmed: z
    .literal(true, { error: "Ask the user to confirm the delete first, then pass confirmed: true" })
    .describe("Pass true only after the user asked to delete this topic and said yes in chat, knowing it is permanent"),
});
export type DeleteTopicInput = z.infer<typeof DeleteTopicInput>;

/** A "builds on" link named by terms: how Claude says it. */
export const LinkTopicsInput = z.object({
  term: Term.describe("The topic that builds on the other, as it appears in PrepUp, e.g. 'RAG'"),
  buildsOnTerm: Term.describe("The prerequisite: what it builds on, as it appears in PrepUp, e.g. 'Embeddings'"),
  deck: InDeck.describe("The deck both topics are in. Links stay inside one deck"),
});
export type LinkTopicsInput = z.infer<typeof LinkTopicsInput>;

/** The same link named by id: how the web app says it. The topic itself is in the URL. */
export const LinkTopicInput = z.object({
  buildsOnId: z.uuid("Pick a topic to build on"),
});
export type LinkTopicInput = z.infer<typeof LinkTopicInput>;

export const SearchTopicsInput = z.object({
  query: z
    .string()
    .trim()
    .min(1, "Type something to search for")
    .max(80, "Keep searches under 80 characters")
    .describe("Words or part of a term, e.g. 'vector'"),
  limit: z.number().int().min(1).max(50).default(10),
  deck: DeckName.optional().describe("Only search this deck, by name. Leave it out to search every deck"),
});
export type SearchTopicsInput = z.input<typeof SearchTopicsInput>;

export const SetScoreInput = z.object({ score: ManualScore });
export type SetScoreInput = z.infer<typeof SetScoreInput>;

export const UpdateTopicInput = z
  .object({
    importance: Importance.optional(),
    explanation: z.string().max(4000).optional(),
  })
  .refine((v) => v.importance !== undefined || v.explanation !== undefined, {
    message: "Nothing to update",
  });
export type UpdateTopicInput = z.infer<typeof UpdateTopicInput>;

/** Creating a deck: by name from an assistant or the web app. */
export const CreateDeckInput = z.object({
  name: DeckName.describe("The new deck's name, e.g. 'DSA' or 'System Design'"),
});
export type CreateDeckInput = z.infer<typeof CreateDeckInput>;

/** Renaming a deck from the web app (the deck is in the URL). */
export const RenameDeckInput = z.object({ name: DeckName });
export type RenameDeckInput = z.infer<typeof RenameDeckInput>;

/** Renaming a deck by name, as an assistant asks. */
export const RenameDeckByNameInput = z.object({
  deck: DeckName.describe("The deck to rename, by its current name"),
  newName: DeckName.describe("Its new name"),
});
export type RenameDeckByNameInput = z.infer<typeof RenameDeckByNameInput>;

/** Deleting a deck by name, as an assistant asks. Like deleting a topic, it needs the user's yes. */
export const DeleteDeckInput = z.object({
  deck: DeckName.describe("The deck to delete, by name"),
  confirmed: z
    .literal(true, { error: "Ask the user to confirm the delete first, then pass confirmed: true" })
    .describe(
      "Pass true only after the user asked to delete this deck and said yes in chat, knowing every topic in it is deleted too, permanently",
    ),
});
export type DeleteDeckInput = z.infer<typeof DeleteDeckInput>;

/** Moving a topic to another deck from the web app (the topic is in the URL). */
export const MoveTopicInput = z.object({ deckId: z.uuid("Pick a deck") });
export type MoveTopicInput = z.infer<typeof MoveTopicInput>;

/** Moving a topic by names, as an assistant asks. */
export const MoveTopicByNameInput = z.object({
  term: Term.describe("The topic to move, as it appears in PrepUp"),
  deck: InDeck.describe("The deck it is in now. Leave it out when the topic is in only one deck"),
  toDeck: DeckName.describe("The deck to move it to, by name. It must exist already"),
});
export type MoveTopicByNameInput = z.infer<typeof MoveTopicByNameInput>;

/** A deck and how many topics it holds. */
export interface DeckView {
  id: string;
  name: string;
  topicCount: number;
  createdAt: string;
}

/** Just enough of a deck to name it. */
export interface DeckRef {
  id: string;
  name: string;
}

/** The longest testing style a user can save. Long enough for a persona, short enough to stay a style. */
export const TESTING_STYLE_MAX = 1500;

export const UpdateSettingsInput = z.object({
  testingStyle: z
    .string()
    .trim()
    .min(1, "Describe how you want to be tested")
    .max(TESTING_STYLE_MAX, `Keep it under ${TESTING_STYLE_MAX} characters`),
});
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsInput>;

/** How much of the shared host is in use. Totals only: nothing here identifies a person or a topic. */
export interface HostUsage {
  people: number;
  topics: number;
  /** Size of the database on disk, or null when the host can't measure it. */
  databaseBytes: number | null;
}

/** What the public costs page shows: what the host pays, what it has room for, and each person's limits. */
export interface HostStatusView {
  monthlyCostUsd: number;
  supportUrl: string | null;
  sourceUrl: string;
  usage: HostUsage;
  databaseLimitBytes: number;
  /** Request limits are null when the host sets none. */
  limits: { topicsPerPerson: number; requestsPerMinute: number | null; requestsPerDay: number | null };
}

export interface UserSettingsView {
  /** How this user wants to be tested; the default preset until they change it. */
  testingStyle: string;
  /** The preset the style matches exactly, or null when it's their own wording. */
  preset: string | null;
  updatedAt: string | null;
}

/** Just enough of a topic to name it and open it. */
export interface TopicRef {
  id: string;
  term: string;
}

/** What every client sees for a topic. Scores here are already decayed. */
export interface TopicView {
  id: string;
  term: string;
  /** The deck it is in. The same term can be in several decks, as separate topics. */
  deck: DeckRef;
  sourceUrl: string | null;
  importance: Importance;
  explanation: string;
  /** Who last wrote the explanation: you in the web app, or Claude after a test. */
  explanationBy: "you" | "claude" | null;
  explanationUpdatedAt: string | null;
  /** 0 when never scored or set to 0 by you, otherwise 1–5. */
  score: ShownScore;
  level: LevelName;
  createdAt: string;
  lastTestedAt: string | null;
  /** Days until the score drops one step; null when it cannot drop (score 0 or 1). */
  daysUntilDrop: number | null;
  fadingSoon: boolean;
  fadingThisWeek: boolean;
  priority: number;
  /** Its prerequisites: the topics this one builds on. Links never change a score or the fade clock. */
  buildsOn: TopicRef[];
  /** The topics that build on this one. */
  neededFor: TopicRef[];
}

export interface ReviewEventView {
  id: string;
  kind: EventKind;
  score: number | null;
  explained: boolean;
  /** Claude's one-line reason for a test score. */
  feedback: string | null;
  /** Your answer during a test, or the new explanation for an explanation edit. */
  text: string | null;
  source: EventSource;
  createdAt: string;
}
