import { describe, expect, it } from "vitest";
import { DomainError, InMemoryRepository, PrepUpService } from "../src/index.js";

function setup(start = new Date("2026-11-01T09:00:00Z")) {
  let now = start;
  const service = new PrepUpService(new InMemoryRepository(), () => now);
  const advance = (days: number) => {
    now = new Date(now.getTime() + days * 86_400_000);
  };
  return { service, advance };
}

describe("PrepUpService", () => {
  it("captures a term once, even when spelled differently", async () => {
    const { service } = setup();
    const me = await service.resolveActor("user-1");
    const first = await service.addTopic(me, { term: "LangChain" });
    const again = await service.addTopic(me, { term: "lang chain" });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.topic.id).toBe(first.topic.id);
    expect(await service.listTopics(me)).toHaveLength(1);
  });

  it("starts new topics at Shaky with medium importance", async () => {
    const { service } = setup();
    const me = await service.resolveActor("user-1");
    const { topic } = await service.addTopic(me, { term: "RAG", sourceUrl: "https://youtube.com/watch?v=x" });
    expect(topic).toMatchObject({ score: 1, level: "Shaky", importance: "medium", daysUntilDrop: null });
  });

  it("rejects invalid input with a readable message", async () => {
    const { service } = setup();
    const me = await service.resolveActor("user-1");
    await expect(service.addTopic(me, { term: "   " })).rejects.toThrow(DomainError);
    await expect(service.addTopic(me, { term: "x", sourceUrl: "javascript:alert(1)" })).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("records a Claude test, which resets the fade clock", async () => {
    const { service, advance } = setup();
    const me = await service.resolveActor("user-1");
    await service.addTopic(me, { term: "RAG" });
    const tested = await service.recordReview(me, { term: "rag", score: 3, feedback: "Solid on retrieval, vague on chunking" });
    expect(tested).toMatchObject({ score: 3, daysUntilDrop: 14 });

    advance(12);
    expect((await service.findByTerm(me, "RAG")).fadingSoon).toBe(true);

    await service.recordReview(me, { term: "RAG", score: 3, feedback: "Still a 3" });
    expect(await service.findByTerm(me, "RAG")).toMatchObject({ daysUntilDrop: 14, fadingSoon: false });
  });

  it("only allows a 5 when the topic was explained clearly", async () => {
    const { service } = setup();
    const me = await service.resolveActor("user-1");
    await service.addTopic(me, { term: "Embeddings" });
    await expect(service.recordReview(me, { term: "Embeddings", score: 5, feedback: "Great" })).rejects.toMatchObject({
      code: "rule",
    });
    const ok = await service.recordReview(me, { term: "Embeddings", score: 5, explained: true, feedback: "Clear" });
    expect(ok.level).toBe("Can explain");
  });

  it("does not reset the fade clock on a manual edit, and labels it in history", async () => {
    const { service, advance } = setup();
    const me = await service.resolveActor("user-1");
    const { topic } = await service.addTopic(me, { term: "MCP" });
    await service.recordReview(me, { term: "MCP", score: 2, feedback: "Knows the idea" });
    advance(10);
    const edited = await service.setScore(me, topic.id, { score: 4 }, "web");
    expect(edited).toMatchObject({ score: 4, daysUntilDrop: 4 });

    const history = await service.history(me, topic.id);
    expect(history.map((e) => e.kind)).toEqual(["manual_edit", "claude_test"]);
    expect(history[0]).toMatchObject({ source: "web", score: 4 });
  });

  it("filters and sorts by priority", async () => {
    const { service } = setup();
    const me = await service.resolveActor("user-1");
    for (const term of ["Evals", "Temperature", "Agents"]) await service.addTopic(me, { term });
    const evals = await service.findByTerm(me, "Evals");
    const temp = await service.findByTerm(me, "Temperature");
    await service.updateTopic(me, evals.id, { importance: "high" }, "web");
    await service.setScore(me, temp.id, { score: 4 }, "web");

    // Prep now = every weak topic (score 1-2), the important ones first.
    expect((await service.listTopics(me, { filter: "prep" })).map((t) => t.term)).toEqual(["Evals", "Agents"]);
    expect((await service.listTopics(me, { filter: "confident" })).map((t) => t.term)).toEqual(["Temperature"]);
    expect((await service.listTopics(me)).map((t) => t.term)).toEqual(["Evals", "Agents", "Temperature"]);
  });

  it("logs explanation changes but not unchanged saves", async () => {
    const { service } = setup();
    const me = await service.resolveActor("user-1");
    const { topic } = await service.addTopic(me, { term: "RAG" });
    await service.updateTopic(me, topic.id, { explanation: "Retrieve, then generate" }, "web");
    await service.updateTopic(me, topic.id, { explanation: "Retrieve, then generate" }, "web");
    const history = await service.history(me, topic.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: "explanation", text: "Retrieve, then generate" });
  });

  it("keeps workspaces apart", async () => {
    const { service } = setup();
    const alice = await service.resolveActor("alice");
    const bob = await service.resolveActor("bob");
    const { topic } = await service.addTopic(alice, { term: "RLHF" });
    expect(await service.listTopics(bob)).toEqual([]);
    await expect(service.getTopic(bob, topic.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(service.setScore(bob, topic.id, { score: 5 }, "web")).rejects.toMatchObject({ code: "not_found" });
  });

  it("deletes a topic with its history, only within the owner's workspace", async () => {
    const { service } = setup();
    const alice = await service.resolveActor("alice");
    const bob = await service.resolveActor("bob");
    const { topic } = await service.addTopic(alice, { term: "RAG" });
    await service.recordReview(alice, { term: "RAG", score: 3, feedback: "ok" });

    await expect(service.deleteTopic(bob, topic.id)).rejects.toMatchObject({ code: "not_found" });
    expect(await service.deleteTopic(alice, topic.id)).toEqual({ term: "RAG" });
    expect(await service.listTopics(alice)).toEqual([]);
    await expect(service.history(alice, topic.id)).rejects.toMatchObject({ code: "not_found" });

    // Capturing it again starts fresh.
    const again = await service.addTopic(alice, { term: "rag" });
    expect(again).toMatchObject({ created: true, topic: { score: 1 } });
  });
});
