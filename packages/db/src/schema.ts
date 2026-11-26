/**
 * Multi-tenant from day one: every row carries a workspace_id. v1 creates one
 * personal workspace per user; v3 collaboration adds members, not a migration.
 *
 * Scores are never stored on the topic. They are computed from the
 * append-only review_events log when read (see @prepup/core scoring).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ownerId: uuid("owner_id").notNull(),
    personal: boolean("personal").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    // One personal workspace per user; the unique index makes first-login creation race-safe.
    uniqueIndex("workspaces_one_personal_per_owner").on(t.ownerId).where(sql`${t.personal}`),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

/**
 * A named group of topics, like "DSA". Every topic is in exactly one deck;
 * deleting a deck deletes its topics. Names are unique per workspace, ignoring
 * case and punctuation.
 */
export const decks = pgTable(
  "decks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("decks_workspace_name_unique").on(t.workspaceId, t.normalizedName)],
);

export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    deckId: uuid("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    normalizedTerm: text("normalized_term").notNull(),
    sourceUrl: text("source_url"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    /** When an assistant last checked what this topic builds on. Null: not checked yet (new, or moved to another deck). */
    linksCheckedAt: timestamp("links_checked_at", { withTimezone: true }),
  },
  // Duplicate captures merge: the same normalized term can exist once per deck (and in several decks).
  (t) => [
    uniqueIndex("topics_deck_term_unique").on(t.deckId, t.normalizedTerm),
    index("topics_workspace_term_idx").on(t.workspaceId, t.normalizedTerm),
  ],
);

/** Per-person view of a shared topic: importance and your own explanation. */
export const topicSettings = pgTable(
  "topic_settings",
  {
    userId: uuid("user_id").notNull(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    importance: text("importance", { enum: ["high", "medium", "low"] })
      .notNull()
      .default("medium"),
    explanation: text("explanation").notNull().default(""),
    /** The level this person tests the topic at now. A 5 from a test moves it up; they can change it on the card. */
    understanding: text("understanding", { enum: ["beginner", "intermediate", "advanced"] })
      .notNull()
      .default("beginner"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.topicId] })],
);

/**
 * One row per "builds on": `topic_id` builds on `builds_on_id`. The primary
 * key makes a pair unique and the check forbids self-links; loops are
 * rejected by the core, which sees the whole graph. Deleting either topic
 * removes the link.
 */
export const topicLinks = pgTable(
  "topic_links",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    buildsOnId: uuid("builds_on_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.topicId, t.buildsOnId] }),
    index("topic_links_builds_on_idx").on(t.buildsOnId),
    index("topic_links_workspace_idx").on(t.workspaceId),
    check("topic_links_no_self_link", sql`${t.topicId} <> ${t.buildsOnId}`),
  ],
);

/** Personal settings that aren't about one topic: how the user wants to be tested, and automatic linking. */
export const userSettings = pgTable(
  "user_settings",
  {
    userId: uuid("user_id").primaryKey(),
    /** Null until the user saves a style of their own (they get the default). */
    testingStyle: text("testing_style"),
    /** Whether their assistant may link new topics to their prerequisites without asking first. Off unless they turn it on. */
    autoLink: boolean("auto_link").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("user_settings_style_length", sql`char_length(${t.testingStyle}) BETWEEN 1 AND 1500`)],
);

/**
 * One row per user: how many requests they made in the current minute and
 * day. Shared by every serverless instance, which in-memory counters are not.
 */
export const rateLimits = pgTable("rate_limits", {
  userId: uuid("user_id").primaryKey(),
  minuteStart: timestamp("minute_start", { withTimezone: true }).notNull(),
  minuteCount: integer("minute_count").notNull(),
  dayStart: timestamp("day_start", { withTimezone: true }).notNull(),
  dayCount: integer("day_count").notNull(),
});

/** Append-only. Every Claude test, manual score edit and explanation change. */
export const reviewEvents = pgTable(
  "review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    kind: text("kind", { enum: ["claude_test", "manual_edit", "explanation"] }).notNull(),
    score: integer("score"),
    /** The understanding level a score is for. Null exactly for explanation changes. */
    understanding: text("understanding", { enum: ["beginner", "intermediate", "advanced"] }),
    explained: boolean("explained").notNull().default(false),
    feedback: text("feedback"),
    text: text("text"),
    source: text("source", { enum: ["web", "mcp"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("review_events_topic_user_time_idx").on(t.topicId, t.userId, t.createdAt),
    check("review_events_score_range", sql`${t.score} IS NULL OR ${t.score} BETWEEN 0 AND 5`),
    // 0 resets a topic to "Not tested yet"; only you can set it, never a test.
    check("review_events_zero_is_manual", sql`${t.score} IS DISTINCT FROM 0 OR ${t.kind} = 'manual_edit'`),
    check("review_events_level_matches_kind", sql`(${t.kind} = 'explanation') = (${t.understanding} IS NULL)`),
    check(
      "review_events_score_matches_kind",
      sql`(${t.kind} = 'explanation') = (${t.score} IS NULL)`,
    ),
    check("review_events_five_needs_explained", sql`${t.score} IS DISTINCT FROM 5 OR ${t.kind} <> 'claude_test' OR ${t.explained}`),
  ],
);
