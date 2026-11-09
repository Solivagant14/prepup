/**
 * Runs the real migrations and the real Postgres adapter against PGlite, an
 * in-process Postgres, so these tests need no Docker or network.
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PrepUpService } from "@prepup/core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { PostgresRepository, schema, type Db } from "../src/index.js";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

let db: Db;
let now: Date;
let service: PrepUpService;
const advance = (days: number) => {
  now = new Date(now.getTime() + days * 86_400_000);
};

beforeEach(async () => {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, { migrationsFolder });
  db = pg as unknown as Db;
  now = new Date("2026-11-01T09:00:00Z");
  service = new PrepUpService(new PostgresRepository(db), () => now);
});

describe("PostgresRepository", () => {
  it("creates one personal workspace per user, even when asked twice at once", async () => {
    const user = randomUUID();
    const [a, b] = await Promise.all([service.resolveActor(user), service.resolveActor(user)]);
    expect(a.workspaceId).toBe(b.workspaceId);
    const rows = await db.select().from(schema.workspaces);
    expect(rows).toHaveLength(1);
    const members = await db.select().from(schema.memberships);
    expect(members).toMatchObject([{ userId: user, role: "owner" }]);
  });

  it("merges duplicate captures through the unique index", async () => {
    const me = await service.resolveActor(randomUUID());
    const results = await Promise.all([
      service.addTopic(me, { term: "LangChain" }),
      service.addTopic(me, { term: "lang chain" }),
      service.addTopic(me, { term: "Lang-Chain" }),
    ]);
    expect(new Set(results.map((r) => r.topic.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it("computes scores from the event log, matching the in-memory rules", async () => {
    const me = await service.resolveActor(randomUUID());
    const { topic } = await service.addTopic(me, { term: "RAG" });
    await service.recordReview(me, { term: "RAG", score: 3, feedback: "Good", answer: "Retrieve then generate" });
    advance(10);
    await service.setScore(me, topic.id, { score: 4 }, "web");
    expect(await service.getTopic(me, topic.id)).toMatchObject({ score: 4, daysUntilDrop: 4, fadingSoon: false });
    advance(4);
    expect(await service.getTopic(me, topic.id)).toMatchObject({ score: 3, daysUntilDrop: 14 });

    const history = await service.history(me, topic.id);
    expect(history.map((e) => [e.kind, e.source])).toEqual([
      ["manual_edit", "web"],
      ["claude_test", "mcp"],
    ]);
    expect(history[1]).toMatchObject({ text: "Retrieve then generate", feedback: "Good" });
  });

  it("stores importance and explanation per person", async () => {
    const me = await service.resolveActor(randomUUID());
    const { topic } = await service.addTopic(me, { term: "Evals" });
    await service.updateTopic(me, topic.id, { importance: "high" }, "web");
    await service.updateTopic(me, topic.id, { explanation: "Measure before you ship" }, "mcp");
    expect(await service.getTopic(me, topic.id)).toMatchObject({
      importance: "high",
      explanation: "Measure before you ship",
    });
    expect((await service.listTopics(me, { filter: "prep" })).map((t) => t.term)).toEqual(["Evals"]);
  });

  it("never returns another workspace's topics", async () => {
    const alice = await service.resolveActor(randomUUID());
    const bob = await service.resolveActor(randomUUID());
    const { topic } = await service.addTopic(alice, { term: "RLHF" });
    await service.addTopic(bob, { term: "RLHF" });
    expect(await service.listTopics(bob)).toHaveLength(1);
    await expect(service.getTopic(bob, topic.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(service.history(bob, topic.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects an unearned 5 in the database too, not only in the service", async () => {
    const me = await service.resolveActor(randomUUID());
    const { topic } = await service.addTopic(me, { term: "MCP" });
    await expect(
      db.insert(schema.reviewEvents).values({
        workspaceId: me.workspaceId,
        topicId: topic.id,
        userId: me.userId,
        kind: "claude_test",
        score: 5,
        explained: false,
        source: "mcp",
      }),
    ).rejects.toThrow();
  });

  it("cascades a delete to settings and review events", async () => {
    const me = await service.resolveActor(randomUUID());
    const { topic } = await service.addTopic(me, { term: "Evals" });
    await service.updateTopic(me, topic.id, { importance: "high", explanation: "Measure it" }, "web");
    await service.recordReview(me, { term: "Evals", score: 2, feedback: "ok" });
    await service.deleteTopic(me, topic.id);
    expect(await db.select().from(schema.topics)).toHaveLength(0);
    expect(await db.select().from(schema.topicSettings)).toHaveLength(0);
    expect(await db.select().from(schema.reviewEvents)).toHaveLength(0);
  });

  it("saves a test and its drafted explanation in one transaction", async () => {
    const me = await service.resolveActor(randomUUID());
    const { topic } = await service.addTopic(me, { term: "RAG" });
    const saved = await service.recordReview(me, {
      term: "RAG",
      score: 3,
      feedback: "ok",
      explanation: "RAG is when I retrieve my own documents and add them to the prompt.",
    });
    expect(saved).toMatchObject({ explanationBy: "claude", explanation: expect.stringContaining("retrieve") });
    expect(await db.select().from(schema.reviewEvents)).toHaveLength(2);
    expect(topic.explanationBy).toBeNull();
  });

  it("rolls the whole change back if any part fails", async () => {
    const me = await service.resolveActor(randomUUID());
    const { topic } = await service.addTopic(me, { term: "MCP" });
    const repo = new PostgresRepository(db);
    const now = new Date();
    await expect(
      repo.applyChanges({
        settings: { userId: me.userId, topicId: topic.id, patch: { explanation: "should not stick" }, now },
        events: [
          {
            workspaceId: me.workspaceId,
            topicId: topic.id,
            userId: me.userId,
            kind: "claude_test",
            score: 5,
            explained: false, // violates the database's "a 5 must be earned" check
            feedback: null,
            text: null,
            source: "mcp",
            createdAt: now,
          },
        ],
      }),
    ).rejects.toThrow();
    expect(await db.select().from(schema.topicSettings)).toHaveLength(0);
    expect((await service.getTopic(me, topic.id)).explanation).toBe("");
  });
});
