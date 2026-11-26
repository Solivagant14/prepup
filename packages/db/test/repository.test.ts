/**
 * Runs the real migrations and the real Postgres adapter against PGlite, an
 * in-process Postgres, so these tests need no Docker or network.
 */
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PrepUpService } from "@prepup/core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { PostgresRateLimitStore, PostgresRepository, schema, type Db } from "../src/index.js";

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
        understanding: "beginner",
        explained: false,
        source: "mcp",
      }),
    ).rejects.toThrow();
  });

  it("keeps a score per understanding level and refuses a score without its level", async () => {
    const me = await service.resolveActor(randomUUID());
    const { topic } = await service.addTopic(me, { term: "RAG" });
    await service.recordReview(me, { term: "RAG", score: 5, explained: true, feedback: "Clear" });
    const moved = await service.getTopic(me, topic.id);
    expect(moved).toMatchObject({ understanding: "intermediate", score: 0 });
    expect(moved.levels.map((l) => l.score)).toEqual([5, 0, 0]);
    await service.recordReview(me, { term: "RAG", score: 2, feedback: "Partial" });
    await service.updateTopic(me, topic.id, { understanding: "beginner" }, "web");
    expect(await service.getTopic(me, topic.id)).toMatchObject({ understanding: "beginner", score: 5 });
    expect((await service.history(me, topic.id)).map((e) => e.understanding)).toEqual(["intermediate", "beginner"]);
    await expect(
      db.insert(schema.reviewEvents).values({
        workspaceId: me.workspaceId,
        topicId: topic.id,
        userId: me.userId,
        kind: "manual_edit",
        score: 3,
        source: "web",
      }),
    ).rejects.toThrow();
  });

  it("stores a manual 0, and refuses a 0 from a test in the database too", async () => {
    const me = await service.resolveActor(randomUUID());
    const { topic } = await service.addTopic(me, { term: "RAG" });
    await service.recordReview(me, { term: "RAG", score: 3, feedback: "Good" });
    expect(await service.setScore(me, topic.id, { score: 0 }, "web")).toMatchObject({ score: 0, level: "Not tested yet" });
    await expect(
      db.insert(schema.reviewEvents).values({
        workspaceId: me.workspaceId,
        topicId: topic.id,
        userId: me.userId,
        kind: "claude_test",
        score: 0,
        understanding: "beginner",
        explained: false,
        source: "mcp",
      }),
    ).rejects.toThrow();
  });

  it("keeps a term once per deck, links inside one deck, and deletes a deck with its topics", async () => {
    const me = await service.resolveActor(randomUUID());
    const dsa = (await service.createDeck(me, { name: "DSA" })).deck;
    const sys = (await service.createDeck(me, { name: "System Design" })).deck;
    const results = await Promise.all([
      service.addTopic(me, { term: "Hashing", deckId: dsa.id }),
      service.addTopic(me, { term: "hashing", deckId: dsa.id }),
      service.addTopic(me, { term: "Hashing", deckId: sys.id }),
    ]);
    expect(new Set(results.map((r) => r.topic.id)).size).toBe(2);
    const arrays = (await service.addTopic(me, { term: "Arrays", deckId: dsa.id })).topic;
    const hashing = results[0]!.topic;
    const caching = (await service.addTopic(me, { term: "Caching", deckId: sys.id })).topic;

    // The adapter refuses a link across decks, whatever the caller checked.
    await expect(
      new PostgresRepository(db).insertLinkIfAbsent(
        { workspaceId: me.workspaceId, topicId: caching.id, buildsOnId: arrays.id, createdBy: me.userId, createdAt: now },
        () => {},
      ),
    ).rejects.toThrow(/same deck/);
    await service.linkTopics(me, hashing.id, { buildsOnId: arrays.id });
    await service.recordReview(me, { term: "Hashing", deck: "DSA", score: 3, feedback: "Good" });
    const moved = await service.moveTopic(me, arrays.id, { deckId: sys.id });
    expect(moved).toMatchObject({ removedLinks: 1, topic: { deck: { name: "System Design" } } });
    expect(await db.select().from(schema.topicLinks)).toEqual([]);

    expect(await service.deleteDeck(me, dsa.id)).toEqual({ name: "DSA", topicCount: 1 });
    expect((await service.listTopics(me)).map((t) => t.term).sort()).toEqual(["Arrays", "Caching", "Hashing"]);
    expect((await db.select().from(schema.reviewEvents)).length).toBe(0);
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
            understanding: "beginner",
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

  it("enforces the topic cap against the real count", async () => {
    const capped = new PrepUpService(new PostgresRepository(db), () => now, { maxTopics: 1 });
    const me = await capped.resolveActor(randomUUID());
    await capped.addTopic(me, { term: "RAG" });
    await expect(capped.addTopic(me, { term: "MCP" })).rejects.toMatchObject({ code: "rule" });
    expect((await capped.addTopic(me, { term: "rag" })).created).toBe(false);
  });

  it("deletes all of one user's rows and nobody else's", async () => {
    const alice = await service.resolveActor(randomUUID());
    const bob = await service.resolveActor(randomUUID());
    await service.addTopic(alice, { term: "RAG" });
    await service.updateTopic(alice, (await service.findByTerm(alice, "RAG")).id, { importance: "high" }, "web");
    await service.recordReview(alice, { term: "RAG", score: 3, feedback: "ok" });
    await service.addTopic(bob, { term: "RAG" });
    await service.recordReview(bob, { term: "RAG", score: 2, feedback: "ok" });
    await new PostgresRateLimitStore(db).hit(alice.userId, now);

    await service.deleteAccount(alice);

    expect(await db.select().from(schema.workspaces)).toMatchObject([{ ownerId: bob.userId }]);
    expect(await db.select().from(schema.memberships)).toMatchObject([{ userId: bob.userId }]);
    expect(await db.select().from(schema.topics)).toHaveLength(1);
    expect(await db.select().from(schema.topicSettings)).toHaveLength(0);
    expect(await db.select().from(schema.reviewEvents)).toMatchObject([{ userId: bob.userId }]);
    expect(await db.select().from(schema.rateLimits)).toHaveLength(0);
  });
});

describe("topic links", () => {
  const ids = async (actor: Awaited<ReturnType<PrepUpService["resolveActor"]>>, ...terms: string[]) => {
    const out: Record<string, string> = {};
    for (const term of terms) out[term] = (await service.addTopic(actor, { term })).topic.id;
    return out;
  };

  it("stores links and reads them back in both directions, alone and in the list", async () => {
    const me = await service.resolveActor(randomUUID());
    const id = await ids(me, "RAG", "Embeddings", "Vector databases");
    await service.linkTopics(me, id.RAG!, { buildsOnId: id.Embeddings! });
    await service.linkTopics(me, id.RAG!, { buildsOnId: id["Vector databases"]! });

    const rag = await service.getTopic(me, id.RAG!);
    expect(rag.buildsOn.map((t) => t.term)).toEqual(["Embeddings", "Vector databases"]);
    expect((await service.getTopic(me, id.Embeddings!)).neededFor).toEqual([{ id: id.RAG, term: "RAG" }]);
    const listed = await service.listTopics(me);
    expect(listed.find((t) => t.id === id.RAG)!.buildsOn).toEqual(rag.buildsOn);
    expect(listed.find((t) => t.id === id.Embeddings)!.neededFor).toEqual([{ id: id.RAG, term: "RAG" }]);
    expect(await db.select().from(schema.topicLinks)).toMatchObject([
      { workspaceId: me.workspaceId, createdBy: me.userId },
      { workspaceId: me.workspaceId, createdBy: me.userId },
    ]);
  });

  it("keeps one row when the same link arrives several times at once", async () => {
    const me = await service.resolveActor(randomUUID());
    const id = await ids(me, "RAG", "Embeddings");
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.linkTopics(me, id.RAG!, { buildsOnId: id.Embeddings! })),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await db.select().from(schema.topicLinks)).toHaveLength(1);
  });

  it("lets only one of two opposite links through when they arrive together", async () => {
    const me = await service.resolveActor(randomUUID());
    const id = await ids(me, "RAG", "Embeddings");
    const results = await Promise.allSettled([
      service.linkTopics(me, id.RAG!, { buildsOnId: id.Embeddings! }),
      service.linkTopics(me, id.Embeddings!, { buildsOnId: id.RAG! }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "rule" } });
    expect(await db.select().from(schema.topicLinks)).toHaveLength(1);
  });

  it("rejects loops and enforces the cap against the real rows", async () => {
    const me = await service.resolveActor(randomUUID());
    const id = await ids(me, "Agents", "RAG", "Embeddings");
    await service.linkTopics(me, id.Agents!, { buildsOnId: id.RAG! });
    await service.linkTopics(me, id.RAG!, { buildsOnId: id.Embeddings! });
    await expect(service.linkTopics(me, id.Embeddings!, { buildsOnId: id.Agents! })).rejects.toMatchObject({
      code: "rule",
      message: expect.stringContaining("would make a loop"),
    });
    expect(await db.select().from(schema.topicLinks)).toHaveLength(2);

    const many = await ids(me, ...Array.from({ length: 21 }, (_, i) => `Basics ${i}`));
    for (let i = 0; i < 20; i++) await service.linkTopics(me, id.Embeddings!, { buildsOnId: many[`Basics ${i}`]! });
    await expect(service.linkTopics(me, id.Embeddings!, { buildsOnId: many["Basics 20"]! })).rejects.toMatchObject({
      code: "rule",
      message: expect.stringContaining("already builds on 20 topics"),
    });
  });

  it("refuses self-links, duplicates and cross-workspace links in the database too", async () => {
    const alice = await service.resolveActor(randomUUID());
    const bob = await service.resolveActor(randomUUID());
    const hers = await ids(alice, "RAG", "Embeddings");
    const his = await ids(bob, "RAG");
    const row = { workspaceId: alice.workspaceId, createdBy: alice.userId, createdAt: now };

    await expect(db.insert(schema.topicLinks).values({ ...row, topicId: hers.RAG!, buildsOnId: hers.RAG! })).rejects.toThrow();
    await db.insert(schema.topicLinks).values({ ...row, topicId: hers.RAG!, buildsOnId: hers.Embeddings! });
    await expect(
      db.insert(schema.topicLinks).values({ ...row, topicId: hers.RAG!, buildsOnId: hers.Embeddings! }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.topicLinks).values({ ...row, topicId: hers.RAG!, buildsOnId: randomUUID() }),
    ).rejects.toThrow();

    // The adapter itself refuses a link whose other end is in someone else's workspace, whatever the caller checked.
    const repo = new PostgresRepository(db);
    await expect(
      repo.insertLinkIfAbsent({ ...row, topicId: hers.Embeddings!, buildsOnId: his.RAG! }, () => {}),
    ).rejects.toThrow(/same workspace/);
    await expect(service.linkTopics(bob, his.RAG!, { buildsOnId: hers.Embeddings! })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await repo.deleteLink(bob.workspaceId, hers.RAG!, hers.Embeddings!)).toBe(false);
    expect(await repo.listLinks(bob.workspaceId)).toEqual([]);
    expect(await repo.listLinksForTopic(bob.workspaceId, hers.RAG!)).toEqual({ buildsOn: [], neededFor: [] });
    expect(await db.select().from(schema.topicLinks)).toHaveLength(1);
  });

  it("cascades a topic delete to its links, in both directions", async () => {
    const me = await service.resolveActor(randomUUID());
    const id = await ids(me, "Agents", "RAG", "Embeddings");
    await service.linkTopics(me, id.Agents!, { buildsOnId: id.RAG! });
    await service.linkTopics(me, id.RAG!, { buildsOnId: id.Embeddings! });
    await service.linkTopics(me, id.Agents!, { buildsOnId: id.Embeddings! });

    await service.deleteTopic(me, id.RAG!);
    expect(await db.select().from(schema.topicLinks)).toMatchObject([{ topicId: id.Agents, buildsOnId: id.Embeddings }]);
    expect((await service.getTopic(me, id.Agents!)).buildsOn).toEqual([{ id: id.Embeddings, term: "Embeddings" }]);
  });

  it("deletes a user's links with their data and nobody else's", async () => {
    const alice = await service.resolveActor(randomUUID());
    const bob = await service.resolveActor(randomUUID());
    const hers = await ids(alice, "RAG", "Embeddings");
    const his = await ids(bob, "RAG", "Embeddings");
    await service.linkTopics(alice, hers.RAG!, { buildsOnId: hers.Embeddings! });
    await service.linkTopics(bob, his.RAG!, { buildsOnId: his.Embeddings! });

    await service.deleteAccount(alice);
    expect(await db.select().from(schema.topicLinks)).toMatchObject([{ workspaceId: bob.workspaceId, createdBy: bob.userId }]);
  });

  it("sorts prerequisites first in Prep now, from the stored links", async () => {
    const me = await service.resolveActor(randomUUID());
    const id = await ids(me, "Agents", "RAG", "Embeddings");
    await service.updateTopic(me, id.Agents!, { importance: "high" }, "web");
    await service.linkTopics(me, id.Agents!, { buildsOnId: id.RAG! });
    await service.linkTopics(me, id.RAG!, { buildsOnId: id.Embeddings! });
    expect((await service.listTopics(me, { filter: "prep" })).map((t) => t.term)).toEqual(["Embeddings", "RAG", "Agents"]);
    expect((await service.addTopic(me, { term: "Agentic RAG" })).similar.map((t) => t.term)).toEqual(["RAG"]);
  });

  it("still shows the deck if the code runs before the topic_links migration", async () => {
    const me = await service.resolveActor(randomUUID());
    const { topic } = await service.addTopic(me, { term: "RAG" });
    const other = await service.addTopic(me, { term: "Embeddings" });
    await db.execute("DROP TABLE topic_links");

    expect((await service.listTopics(me)).map((t) => t.buildsOn)).toEqual([[], []]);
    expect(await service.getTopic(me, topic.id)).toMatchObject({ term: "RAG", buildsOn: [], neededFor: [] });
    // Linking can't work without the table: it fails loudly instead of pretending.
    await expect(service.linkTopics(me, topic.id, { buildsOnId: other.topic.id })).rejects.toThrow();
  });
});

describe("host usage", () => {
  it("counts people and topics across workspaces and measures the database", async () => {
    const empty = await service.hostUsage();
    expect(empty).toMatchObject({ people: 0, topics: 0 });
    expect(empty.databaseBytes).toBeGreaterThan(0);

    const alice = await service.resolveActor(randomUUID());
    const bob = await service.resolveActor(randomUUID());
    await service.addTopic(alice, { term: "RAG" });
    await service.addTopic(alice, { term: "Embeddings" });
    await service.addTopic(bob, { term: "RAG" });
    expect(await service.hostUsage()).toMatchObject({ people: 2, topics: 3 });

    await service.deleteAccount(alice);
    expect(await service.hostUsage()).toMatchObject({ people: 1, topics: 1 });
  });
});

describe("user settings", () => {
  it("saves and replaces a testing style per user", async () => {
    const alice = await service.resolveActor(randomUUID());
    const bob = await service.resolveActor(randomUUID());
    expect((await service.getSettings(alice)).updatedAt).toBeNull();
    await service.updateSettings(alice, { testingStyle: "First version." });
    advance(1);
    const second = await service.updateSettings(alice, { testingStyle: "Second version." });
    expect(second).toMatchObject({ testingStyle: "Second version.", preset: null, updatedAt: now.toISOString() });
    expect(await db.select().from(schema.userSettings)).toHaveLength(1);
    expect((await service.getSettings(bob)).preset).toBe("interviewer");

    await service.deleteAccount(alice);
    expect(await db.select().from(schema.userSettings)).toHaveLength(0);
  });

  it("refuses an over-long style in the database too", async () => {
    await expect(
      db.insert(schema.userSettings).values({ userId: randomUUID(), testingStyle: "x".repeat(1501) }),
    ).rejects.toThrow();
  });
});

describe("PostgresRateLimitStore", () => {
  it("counts per user and starts over when the minute or day rolls", async () => {
    const store = new PostgresRateLimitStore(db);
    const [a, b] = [randomUUID(), randomUUID()];
    const at = (iso: string) => new Date(iso);

    expect(await store.hit(a, at("2026-11-01T09:00:05Z"))).toEqual({ minute: 1, day: 1 });
    expect(await store.hit(a, at("2026-11-01T09:00:50Z"))).toEqual({ minute: 2, day: 2 });
    expect(await store.hit(b, at("2026-11-01T09:00:55Z"))).toEqual({ minute: 1, day: 1 });
    expect(await store.hit(a, at("2026-11-01T09:01:00Z"))).toEqual({ minute: 1, day: 3 });
    expect(await store.hit(a, at("2026-11-02T00:00:00Z"))).toEqual({ minute: 1, day: 1 });
    expect(await db.select().from(schema.rateLimits)).toHaveLength(2);
  });

  it("counts every request when many arrive at once", async () => {
    const store = new PostgresRateLimitStore(db);
    const user = randomUUID();
    const at = new Date("2026-11-01T09:00:00Z");
    const counts = await Promise.all(Array.from({ length: 10 }, () => store.hit(user, at)));
    expect(counts.map((c) => c.minute).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("the decks migration", () => {
  it("moves existing topics, with their history and links, into one deck per person", async () => {
    const client = new PGlite();
    const pg = drizzle(client, { schema });
    const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    // Build the database as it was before decks, with data in it, then run the decks migration on top.
    const before = mkdtempSync(`${tmpdir()}/prepup-migrations-`);
    mkdirSync(`${before}/meta`);
    const kept = journal.entries.slice(0, journal.entries.findIndex((e) => e.tag === "0006_decks"));
    for (const e of kept) copyFileSync(`${migrationsFolder}/${e.tag}.sql`, `${before}/${e.tag}.sql`);
    writeFileSync(`${before}/meta/_journal.json`, JSON.stringify({ ...journal, entries: kept }));
    await migrate(pg, { migrationsFolder: before });

    const [alice, bob] = [randomUUID(), randomUUID()];
    const raw = (q: string) => client.query<Record<string, unknown>>(q);
    const ws = async (owner: string) =>
      (await raw(`insert into workspaces (name, owner_id) values ('Personal', '${owner}') returning id`)).rows[0]!.id as string;
    const [wa, wb] = [await ws(alice), await ws(bob)];
    const topic = async (w: string, owner: string, term: string) =>
      (
        await raw(
          `insert into topics (workspace_id, term, normalized_term, created_by) values ('${w}', '${term}', '${term.toLowerCase()}', '${owner}') returning id`,
        )
      ).rows[0]!.id as string;
    const rag = await topic(wa, alice, "RAG");
    const emb = await topic(wa, alice, "Embeddings");
    await raw(`insert into topic_links (workspace_id, topic_id, builds_on_id, created_by) values ('${wa}', '${rag}', '${emb}', '${alice}')`);
    await raw(
      `insert into review_events (workspace_id, topic_id, user_id, kind, score, source) values ('${wa}', '${rag}', '${alice}', 'claude_test', 3, 'mcp')`,
    );
    void wb; // Bob has a workspace but no topics: he gets no deck until he first uses one.

    await migrate(pg, { migrationsFolder });
    const migrated = new PrepUpService(new PostgresRepository(pg as unknown as Db), () => now);
    const a = await migrated.resolveActor(alice);
    expect(await migrated.listDecks(a)).toMatchObject([{ name: "My deck", topicCount: 2 }]);
    const ragView = await migrated.findByTerm(a, "RAG");
    expect(ragView).toMatchObject({ score: 3, deck: { name: "My deck" }, buildsOn: [{ term: "Embeddings" }] });
    expect((await raw(`select count(*)::int as n from decks where workspace_id = '${wb}'`)).rows[0]!.n).toBe(0);
    // The automatic-linking migration counts a topic that already builds on something as checked.
    expect(ragView.needsLinks).toBe(false);
    expect((await migrated.findByTerm(a, "Embeddings")).needsLinks).toBe(true);
    // A new topic with the same deck name lands in the migrated deck, not a second "My deck".
    expect((await migrated.addTopic(a, { term: "Agents" })).topic.deck.id).toBe(ragView.deck.id);
  });
});
