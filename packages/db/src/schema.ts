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

export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    normalizedTerm: text("normalized_term").notNull(),
    sourceUrl: text("source_url"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  // Duplicate captures merge: the same normalized term can exist once per workspace.
  (t) => [uniqueIndex("topics_workspace_term_unique").on(t.workspaceId, t.normalizedTerm)],
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.topicId] })],
);

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
    explained: boolean("explained").notNull().default(false),
    feedback: text("feedback"),
    text: text("text"),
    source: text("source", { enum: ["web", "mcp"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("review_events_topic_user_time_idx").on(t.topicId, t.userId, t.createdAt),
    check("review_events_score_range", sql`${t.score} IS NULL OR ${t.score} BETWEEN 1 AND 5`),
    check(
      "review_events_score_matches_kind",
      sql`(${t.kind} = 'explanation') = (${t.score} IS NULL)`,
    ),
    check("review_events_five_needs_explained", sql`${t.score} IS DISTINCT FROM 5 OR ${t.kind} <> 'claude_test' OR ${t.explained}`),
  ],
);
