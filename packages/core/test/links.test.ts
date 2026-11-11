import { MAX_PREREQUISITES } from "@prepup/contracts";
import { describe, expect, it } from "vitest";
import {
  bestMatches,
  buildInstructions,
  dependentsOf,
  FIXED_RULES,
  InMemoryRepository,
  loopPath,
  overlap,
  prerequisitesFirst,
  PrepUpService,
  type Actor,
} from "../src/index.js";

function setup() {
  let now = new Date("2026-11-01T09:00:00Z");
  const service = new PrepUpService(new InMemoryRepository(), () => now);
  const advance = (days: number) => {
    now = new Date(now.getTime() + days * 86_400_000);
  };
  /** Adds the terms and returns their ids by term. */
  const add = async (actor: Actor, ...terms: string[]) => {
    const ids: Record<string, string> = {};
    for (const term of terms) ids[term] = (await service.addTopic(actor, { term })).topic.id;
    return ids;
  };
  const link = (actor: Actor, topicId: string, buildsOnId: string) => service.linkTopics(actor, topicId, { buildsOnId });
  return { service, advance, add, link };
}

const terms = (list: Array<{ term: string }>) => list.map((t) => t.term);

describe("topic links", () => {
  it("links a topic to what it builds on and shows both directions", async () => {
    const { service, add, link } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "RAG", "Embeddings", "Vector databases");

    const first = await link(me, id.RAG!, id.Embeddings!);
    expect(first.created).toBe(true);
    await link(me, id.RAG!, id["Vector databases"]!);

    const rag = await service.getTopic(me, id.RAG!);
    expect(rag.buildsOn).toEqual([
      { id: id.Embeddings, term: "Embeddings" },
      { id: id["Vector databases"], term: "Vector databases" },
    ]);
    expect(rag.neededFor).toEqual([]);
    expect((await service.getTopic(me, id.Embeddings!)).neededFor).toEqual([{ id: id.RAG, term: "RAG" }]);

    // The list carries the same links as the single read.
    const listed = await service.listTopics(me);
    expect(listed.find((t) => t.term === "RAG")).toMatchObject({ buildsOn: rag.buildsOn, neededFor: [] });
    expect(listed.find((t) => t.term === "Vector databases")!.neededFor).toEqual([{ id: id.RAG, term: "RAG" }]);
  });

  it("is idempotent: linking twice keeps one link", async () => {
    const { service, add, link } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "RAG", "Embeddings");
    await link(me, id.RAG!, id.Embeddings!);
    const again = await link(me, id.RAG!, id.Embeddings!);
    expect(again.created).toBe(false);
    expect(again.topic.buildsOn).toHaveLength(1);
  });

  it("rejects a self-link", async () => {
    const { service, add, link } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "RAG");
    await expect(link(me, id.RAG!, id.RAG!)).rejects.toMatchObject({
      code: "rule",
      message: `"RAG" can't build on itself.`,
    });
  });

  it("rejects a direct loop and names both topics", async () => {
    const { service, add, link } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "RAG", "Embeddings");
    await link(me, id.RAG!, id.Embeddings!);
    await expect(link(me, id.Embeddings!, id.RAG!)).rejects.toMatchObject({
      code: "rule",
      message: `"Embeddings" can't build on "RAG": "RAG" already builds on "Embeddings", so this would make a loop.`,
    });
    expect((await service.getTopic(me, id.Embeddings!)).buildsOn).toEqual([]);
  });

  it("rejects an indirect loop, however long the chain", async () => {
    const { service, add, link } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "Agents", "RAG", "Embeddings", "Vectors");
    await link(me, id.Agents!, id.RAG!);
    await link(me, id.RAG!, id.Embeddings!);
    await link(me, id.Embeddings!, id.Vectors!);

    await expect(link(me, id.Embeddings!, id.Agents!)).rejects.toMatchObject({
      code: "rule",
      message: expect.stringMatching(/"Embeddings" can't build on "Agents".*through another topic.*loop/),
    });
    await expect(link(me, id.Vectors!, id.Agents!)).rejects.toMatchObject({
      message: expect.stringContaining("through 2 other topics"),
    });
    // A second route to the same prerequisite is fine: that's a diamond, not a loop.
    expect((await link(me, id.Agents!, id.Vectors!)).created).toBe(true);
  });

  it("allows the reverse link once the first is removed", async () => {
    const { service, add, link } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "RAG", "Embeddings");
    await link(me, id.RAG!, id.Embeddings!);

    const gone = await service.unlinkTopics(me, id.RAG!, id.Embeddings!);
    expect(gone).toMatchObject({ removed: true, topic: { buildsOn: [] } });
    expect((await service.unlinkTopics(me, id.RAG!, id.Embeddings!)).removed).toBe(false);
    expect((await link(me, id.Embeddings!, id.RAG!)).created).toBe(true);
  });

  it(`caps a topic at ${MAX_PREREQUISITES} prerequisites`, async () => {
    const { service, add, link } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "Capstone", ...Array.from({ length: MAX_PREREQUISITES + 1 }, (_, i) => `Basics ${i}`));
    for (let i = 0; i < MAX_PREREQUISITES; i++) await link(me, id.Capstone!, id[`Basics ${i}`]!);

    await expect(link(me, id.Capstone!, id[`Basics ${MAX_PREREQUISITES}`]!)).rejects.toMatchObject({
      code: "rule",
      message: expect.stringContaining(`"Capstone" already builds on ${MAX_PREREQUISITES} topics`),
    });
    // Linking one it already has is still fine, and the cap is per topic, not per deck.
    expect((await link(me, id.Capstone!, id["Basics 0"]!)).created).toBe(false);
    expect((await link(me, id["Basics 0"]!, id["Basics 1"]!)).created).toBe(true);
  });

  it("keeps links inside one workspace", async () => {
    const { service, add, link } = setup();
    const alice = await service.resolveActor("alice");
    const bob = await service.resolveActor("bob");
    const hers = await add(alice, "RAG", "Embeddings");
    const his = await add(bob, "RAG", "Embeddings");
    await link(alice, hers.RAG!, hers.Embeddings!);

    // Bob can't link to, link from, or unlink Alice's topics, and can't see her links.
    await expect(link(bob, his.RAG!, hers.Embeddings!)).rejects.toMatchObject({ code: "not_found" });
    await expect(link(bob, hers.RAG!, his.Embeddings!)).rejects.toMatchObject({ code: "not_found" });
    await expect(service.unlinkTopics(bob, hers.RAG!, hers.Embeddings!)).rejects.toMatchObject({ code: "not_found" });
    expect((await service.getTopic(bob, his.RAG!)).buildsOn).toEqual([]);
    expect((await service.getTopic(alice, hers.RAG!)).buildsOn).toHaveLength(1);

    // The same link in Bob's deck is its own link, and Alice's loop check doesn't see it.
    await link(bob, his.Embeddings!, his.RAG!);
    expect((await service.listTopics(alice)).find((t) => t.term === "Embeddings")!.buildsOn).toEqual([]);
  });

  it("rejects a bad id with a readable message", async () => {
    const { service, add } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "RAG");
    await expect(service.linkTopics(me, id.RAG!, { buildsOnId: "nope" })).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringContaining("Pick a topic to build on"),
    });
  });

  it("links and unlinks by term, the way Claude does", async () => {
    const { service, add } = setup();
    const me = await service.resolveActor("user-1");
    await add(me, "RAG", "Vector databases");
    const linked = await service.linkTopicsByTerm(me, { term: "rag", buildsOnTerm: "vector-databases" });
    expect(linked).toMatchObject({ created: true, buildsOn: { term: "Vector databases" }, topic: { term: "RAG" } });
    await expect(service.linkTopicsByTerm(me, { term: "RAG", buildsOnTerm: "Nope" })).rejects.toMatchObject({
      code: "not_found",
      message: 'No topic called "Nope" in PrepUp',
    });
    expect((await service.unlinkTopicsByTerm(me, { term: "RAG", buildsOnTerm: "Vector databases" })).removed).toBe(true);
  });

  it("removes a topic's links when the topic is deleted", async () => {
    const { service, add, link } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "Agents", "RAG", "Embeddings");
    await link(me, id.Agents!, id.RAG!);
    await link(me, id.RAG!, id.Embeddings!);

    await service.deleteTopic(me, id.RAG!);
    expect((await service.getTopic(me, id.Agents!)).buildsOn).toEqual([]);
    expect((await service.getTopic(me, id.Embeddings!)).neededFor).toEqual([]);
    // With the middle gone, the chain is too: the reverse link is no longer a loop.
    expect((await link(me, id.Embeddings!, id.Agents!)).created).toBe(true);
  });

  it("removes a user's links with their data and leaves everyone else's", async () => {
    const { service, add, link } = setup();
    const alice = await service.resolveActor("alice");
    const bob = await service.resolveActor("bob");
    const hers = await add(alice, "RAG", "Embeddings");
    const his = await add(bob, "RAG", "Embeddings");
    await link(alice, hers.RAG!, hers.Embeddings!);
    await link(bob, his.RAG!, his.Embeddings!);

    await service.deleteAccount(alice);
    expect((await service.getTopic(bob, his.RAG!)).buildsOn).toHaveLength(1);
    const again = await service.resolveActor("alice");
    const fresh = await add(again, "RAG", "Embeddings");
    expect((await service.getTopic(again, fresh.RAG!)).buildsOn).toEqual([]);
  });

  it("never lets a link change a score or the fade clock", async () => {
    const { service, advance, add, link } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "RAG", "Embeddings");
    await service.recordReview(me, { term: "RAG", score: 3, feedback: "ok" });
    advance(10);
    const before = await service.getTopic(me, id.RAG!);

    await link(me, id.RAG!, id.Embeddings!);
    const { buildsOn, ...after } = await service.getTopic(me, id.RAG!);
    expect(after).toEqual({ ...before, buildsOn: undefined });
    expect(buildsOn).toHaveLength(1);
    expect(await service.history(me, id.RAG!)).toHaveLength(1);
  });
});

describe("prerequisites first", () => {
  it("leaves priority order alone when nothing is linked", async () => {
    const { service, add } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "Agents", "Evals", "RAG");
    await service.updateTopic(me, id.RAG!, { importance: "high" }, "web");
    expect(terms(await service.listTopics(me, { filter: "prep" }))).toEqual(["RAG", "Agents", "Evals"]);
  });

  it("sorts a chain of three so each topic follows what it builds on", async () => {
    const { service, add, link } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "Agents", "RAG", "Embeddings", "Evals");
    // Priority alone would say Agents (high), then Embeddings, Evals, RAG by name.
    await service.updateTopic(me, id.Agents!, { importance: "high" }, "web");
    await link(me, id.Agents!, id.RAG!);
    await link(me, id.RAG!, id.Embeddings!);

    expect(terms(await service.listTopics(me, { filter: "prep" }))).toEqual(["Embeddings", "RAG", "Agents", "Evals"]);
    // Only Prep now is reordered; the other lists keep plain priority order.
    expect(terms(await service.listTopics(me, { filter: "all" }))).toEqual(["Agents", "Embeddings", "Evals", "RAG"]);
  });

  it("puts both prerequisites of a topic ahead of it, in their own priority order", async () => {
    const { service, add, link } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "RAG", "Vector databases", "Embeddings", "Agents");
    await service.updateTopic(me, id.RAG!, { importance: "high" }, "web");
    await service.updateTopic(me, id.Embeddings!, { importance: "low" }, "web");
    await link(me, id.RAG!, id.Embeddings!);
    await link(me, id.RAG!, id["Vector databases"]!);

    expect(terms(await service.listTopics(me, { filter: "prep" }))).toEqual([
      "Vector databases",
      "Embeddings",
      "RAG",
      "Agents",
    ]);
  });

  it("skips a prerequisite that isn't weak, but still honours the chain through it", async () => {
    const { service, add, link } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "Agents", "RAG", "Embeddings");
    await service.updateTopic(me, id.Agents!, { importance: "high" }, "web");
    await link(me, id.Agents!, id.RAG!);
    await link(me, id.RAG!, id.Embeddings!);
    await service.setScore(me, id.RAG!, { score: 4 }, "web");

    expect(terms(await service.listTopics(me, { filter: "prep" }))).toEqual(["Embeddings", "Agents"]);
  });

  it("applies the limit after ordering, so a short list starts with the prerequisites", async () => {
    const { service, add, link } = setup();
    const me = await service.resolveActor("user-1");
    const id = await add(me, "Agents", "RAG", "Embeddings");
    await service.updateTopic(me, id.Agents!, { importance: "high" }, "web");
    await link(me, id.Agents!, id.RAG!);
    await link(me, id.RAG!, id.Embeddings!);
    expect(terms(await service.listTopics(me, { filter: "prep", limit: 2 }))).toEqual(["Embeddings", "RAG"]);
  });

  it("orders pure lists, and survives a loop that should never exist", () => {
    const items = ["a", "b", "c", "d"].map((id) => ({ id }));
    const ids = (list: Array<{ id: string }>) => list.map((i) => i.id).join("");
    expect(ids(prerequisitesFirst(items, []))).toBe("abcd");
    expect(ids(prerequisitesFirst(items, [{ topicId: "a", buildsOnId: "d" }]))).toBe("dabc");
    // A diamond: a builds on b and c, which both build on d.
    const diamond = [
      { topicId: "a", buildsOnId: "b" },
      { topicId: "a", buildsOnId: "c" },
      { topicId: "b", buildsOnId: "d" },
      { topicId: "c", buildsOnId: "d" },
    ];
    expect(ids(prerequisitesFirst(items, diamond))).toBe("dbca");
    const loop = [
      { topicId: "a", buildsOnId: "b" },
      { topicId: "b", buildsOnId: "a" },
    ];
    expect(ids(prerequisitesFirst(items, loop)).split("").sort().join("")).toBe("abcd");
    // A chain far deeper than any call stack would like.
    const long = Array.from({ length: 20_000 }, (_, i) => ({ id: String(i) }));
    const chain = long.slice(1).map((item, i) => ({ topicId: String(i), buildsOnId: item.id }));
    expect(prerequisitesFirst(long, chain)[0]).toEqual({ id: "19999" });
  });

  it("finds loops and dependents in plain pairs", () => {
    const links = [
      { topicId: "agents", buildsOnId: "rag" },
      { topicId: "rag", buildsOnId: "embeddings" },
    ];
    expect(loopPath(links, "embeddings", "agents")).toEqual(["agents", "rag", "embeddings"]);
    expect(loopPath(links, "agents", "embeddings")).toBeNull();
    expect(loopPath(links, "rag", "rag")).toEqual(["rag"]);
    expect([...dependentsOf(links, "embeddings")].sort()).toEqual(["agents", "rag"]);
    expect([...dependentsOf(links, "agents")]).toEqual([]);
  });
});

describe("similar topics and search", () => {
  it("returns look-alike topics when one is added, never the topic itself", async () => {
    const { service, add } = setup();
    const me = await service.resolveActor("user-1");
    await add(me, "Embeddings", "Vector databases", "Agents", "Vector search");

    const { similar, created } = await service.addTopic(me, { term: "Embedding models" });
    expect(created).toBe(true);
    expect(terms(similar)).toEqual(["Embeddings"]);
    expect(terms((await service.addTopic(me, { term: "Embedding" })).similar)).toEqual(["Embedding models", "Embeddings"]);
    expect(terms((await service.addTopic(me, { term: "Vector index" })).similar)).toEqual(["Vector databases", "Vector search"]);
    // Capturing it again still answers, and still leaves itself out.
    const again = await service.addTopic(me, { term: "vector index" });
    expect(again.created).toBe(false);
    expect(terms(again.similar)).toEqual(["Vector databases", "Vector search"]);
    // Nothing was linked by any of this.
    expect((await service.listTopics(me)).every((t) => t.buildsOn.length === 0)).toBe(true);
  });

  it("returns at most five, closest first, from this workspace only", async () => {
    const { service, add } = setup();
    const me = await service.resolveActor("user-1");
    const other = await service.resolveActor("user-2");
    await add(other, "Prompt caching");
    await add(me, "Prompt A", "Prompt B", "Prompt C", "Prompt D", "Prompt E", "Prompt F", "Prompt injection attacks");
    const { similar } = await service.addTopic(me, { term: "Prompt injection" });
    expect(similar).toHaveLength(5);
    expect(similar[0]!.term).toBe("Prompt injection attacks");
    expect(terms(similar)).not.toContain("Prompt caching");
  });

  it("ignores overlaps too small to mean anything", () => {
    expect(overlap("C", "CI/CD", 3)).toBe(0);
    expect(overlap("Rate of change", "Bag of words", 3)).toBe(0);
    expect(overlap("The CAP theorem", "The actor model", 3)).toBe(0);
    expect(overlap("Go routines", "Gossip protocol", 3)).toBe(0);
    expect(overlap("Token limits", "Counting tokens", 3)).toBe(1);
    expect(overlap("RAG", "Agentic RAG", 3)).toBeGreaterThan(overlap("Vector search", "Vector databases", 3));
    expect(bestMatches("vec", [{ term: "Vector search" }, { term: "Agents" }], 5, 1)).toEqual([{ term: "Vector search" }]);
  });

  it("searches the deck by text", async () => {
    const { service, add } = setup();
    const me = await service.resolveActor("user-1");
    const other = await service.resolveActor("user-2");
    await add(me, "Vector databases", "Vector search", "RAG", "Agents");
    await add(other, "Vector clocks");

    expect(terms(await service.searchTopics(me, { query: "vector" }))).toEqual(["Vector databases", "Vector search"]);
    expect(terms(await service.searchTopics(me, { query: "data" }))).toEqual(["Vector databases"]);
    expect(terms(await service.searchTopics(me, { query: "vector", limit: 1 }))).toEqual(["Vector databases"]);
    expect(await service.searchTopics(me, { query: "kubernetes" })).toEqual([]);
    await expect(service.searchTopics(me, { query: "  " })).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringContaining("Type something to search for"),
    });
  });
});

describe("fixed rules for links", () => {
  it("tells Claude to ask before linking and to test weaker prerequisites first", () => {
    const ids = FIXED_RULES.map((r) => r.id);
    expect(ids).toEqual(["pick", "prerequisites-first", "one-at-a-time", "no-peeking", "score", "draft", "confirm", "record", "link"]);
    expect(new Set(ids).size).toBe(ids.length);
    const byId = Object.fromEntries(FIXED_RULES.map((r) => [r.id, r]));
    expect(byId.link!.rule).toMatch(/call link_topics only after they say yes/);
    expect(byId["prerequisites-first"]!.rule).toMatch(/builds on is weaker, test that prerequisite first/);
    for (const r of FIXED_RULES) expect(r.why.length).toBeGreaterThan(10);
    // Titles are for people: everyday words, no tool names, and none of them in Claude's instructions.
    for (const r of FIXED_RULES) {
      expect(r.title.length).toBeGreaterThan(10);
      expect(r.title).not.toMatch(/_|list topics|get topic|record review/i);
    }
    expect(new Set(FIXED_RULES.map((r) => r.title)).size).toBe(FIXED_RULES.length);

    const text = buildInstructions("Short and strict.");
    expect(text).toContain(`9. ${byId.link!.rule}`);
    for (const r of FIXED_RULES) expect(text).not.toContain(r.title);
    expect(text).toContain("never change a score or the fade clock");
    expect(text).not.toMatch(/Forward Deployed|FDE|buzzword|interview/i);
  });
});
