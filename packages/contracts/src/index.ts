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

/** How many topics one workspace may hold unless the host sets another cap. Matches the largest list page. */
export const DEFAULT_MAX_TOPICS = 500;

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

export const AddTopicInput = z.object({
  term: Term.describe("The term or concept, e.g. 'RAG' or 'speculative decoding'"),
  sourceUrl: OptionalUrl.describe("Where you heard it, e.g. a YouTube link"),
});
export type AddTopicInput = z.infer<typeof AddTopicInput>;

export const ListTopicsInput = z.object({
  filter: TopicFilter.default("all").describe(
    "all = every topic; prep = weakest topics (score 1-2), most important first, with prerequisites ahead of what builds on them; fading_week = drops within 7 days; confident = score 4+",
  ),
  limit: z.number().int().min(1).max(500).default(20),
});
export type ListTopicsInput = z.input<typeof ListTopicsInput>;

export const RecordReviewInput = z.object({
  term: Term.describe("The topic that was tested, as it appears in PrepUp"),
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
});
export type GetTopicInput = z.infer<typeof GetTopicInput>;

/** A "builds on" link named by terms: how Claude says it. */
export const LinkTopicsInput = z.object({
  term: Term.describe("The topic that builds on the other, as it appears in PrepUp, e.g. 'RAG'"),
  buildsOnTerm: Term.describe("The prerequisite: what it builds on, as it appears in PrepUp, e.g. 'Embeddings'"),
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
});
export type SearchTopicsInput = z.input<typeof SearchTopicsInput>;

export const SetScoreInput = z.object({ score: Score });
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
  sourceUrl: string | null;
  importance: Importance;
  explanation: string;
  /** Who last wrote the explanation: you in the web app, or Claude after a test. */
  explanationBy: "you" | "claude" | null;
  explanationUpdatedAt: string | null;
  score: Score;
  level: (typeof LEVEL_NAMES)[number];
  createdAt: string;
  lastTestedAt: string | null;
  /** Days until the score drops one step; null when it cannot drop (score 1). */
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
