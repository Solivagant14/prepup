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

export const TOPIC_FILTERS = ["all", "prep", "fading_week", "confident"] as const;
export const TopicFilter = z.enum(TOPIC_FILTERS);
export type TopicFilter = z.infer<typeof TopicFilter>;

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
  term: Term.describe("The buzzword or concept, e.g. 'RAG' or 'speculative decoding'"),
  sourceUrl: OptionalUrl.describe("Where you heard it, e.g. a YouTube link"),
});
export type AddTopicInput = z.infer<typeof AddTopicInput>;

export const ListTopicsInput = z.object({
  filter: TopicFilter.default("all").describe(
    "all = every topic; prep = weakest topics (score 1-2), most important first; fading_week = drops within 7 days; confident = score 4+",
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
});
export type RecordReviewInput = z.input<typeof RecordReviewInput>;

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

/** What every client sees for a topic. Scores here are already decayed. */
export interface TopicView {
  id: string;
  term: string;
  sourceUrl: string | null;
  importance: Importance;
  explanation: string;
  score: Score;
  level: (typeof LEVEL_NAMES)[number];
  createdAt: string;
  lastTestedAt: string | null;
  /** Days until the score drops one step; null when it cannot drop (score 1). */
  daysUntilDrop: number | null;
  fadingSoon: boolean;
  fadingThisWeek: boolean;
  priority: number;
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
