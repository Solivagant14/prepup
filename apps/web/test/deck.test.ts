import type { TopicView } from "@prepup/contracts";
import { describe, expect, it } from "vitest";
import {
  cardLook,
  eventLabel,
  explanationNote,
  freshnessText,
  matches,
  mix,
  prefersLightText,
  prerequisiteOptions,
  RAMP,
  shownIn,
  summarize,
} from "../src/lib/deck.js";

const topic = (over: Partial<TopicView>): TopicView => ({
  id: "t",
  term: "RAG",
  sourceUrl: null,
  importance: "medium",
  explanation: "",
  explanationBy: null,
  explanationUpdatedAt: null,
  score: 1,
  level: "Shaky",
  createdAt: "2026-11-01T00:00:00Z",
  lastTestedAt: null,
  daysUntilDrop: null,
  fadingSoon: false,
  fadingThisWeek: false,
  priority: 0,
  buildsOn: [],
  neededFor: [],
  ...over,
});

describe("cardLook", () => {
  it("uses the level's colour when freshly tested", () => {
    expect(cardLook(topic({ score: 4, daysUntilDrop: 14 })).background).toBe(RAMP[3]);
  });

  it("pales toward the level below as the card goes unreviewed", () => {
    const fresh = cardLook(topic({ score: 4, daysUntilDrop: 14 })).background;
    const old = cardLook(topic({ score: 4, daysUntilDrop: 2, fadingSoon: true })).background;
    expect(old).not.toBe(fresh);
    expect(old).toBe(mix(RAMP[3], RAMP[2], (12 / 14) * 0.8));
  });

  it("shows the countdown only in the last 3 days", () => {
    expect(cardLook(topic({ score: 3, daysUntilDrop: 5 })).countdown).toBeNull();
    expect(cardLook(topic({ score: 3, daysUntilDrop: 3, fadingSoon: true })).countdown).toBe(1);
    expect(cardLook(topic({ score: 3, daysUntilDrop: 1, fadingSoon: true })).countdown).toBeCloseTo(1 / 3);
  });

  it("switches to white text on dark cards", () => {
    expect(cardLook(topic({ score: 1 })).ink).toBe("#18181B");
    expect(cardLook(topic({ score: 5, daysUntilDrop: 14 })).ink).toBe("#FFFFFF");
    expect(prefersLightText("#312E81")).toBe(true);
  });
});

describe("filters and summary", () => {
  const deck = [
    topic({ id: "a", importance: "high", score: 1 }),
    topic({ id: "d", importance: "low", score: 2 }),
    topic({ id: "b", importance: "high", score: 4, daysUntilDrop: 5, fadingThisWeek: true }),
    topic({ id: "c", importance: "low", score: 5, daysUntilDrop: 12 }),
  ];

  it("matches the four tabs", () => {
    expect(deck.filter((t) => matches("prep", t)).map((t) => t.id)).toEqual(["a", "d"]);
    expect(deck.filter((t) => matches("fading_week", t)).map((t) => t.id)).toEqual(["b"]);
    expect(deck.filter((t) => matches("confident", t)).map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("summarizes progress", () => {
    expect(summarize(deck)).toMatchObject({ total: 4, confident: 2, confidentPct: 50, prep: 2, fadingWeek: 1 });
    expect(summarize([]).confidentPct).toBe(0);
  });

  it("words freshness", () => {
    expect(freshnessText(topic({ score: 4, daysUntilDrop: 10 }))).toBe("Fresh for 10 more days");
    expect(freshnessText(topic({ score: 4, daysUntilDrop: 1, fadingSoon: true }))).toBe("Drops to Getting there in 1 day");
    expect(freshnessText(topic({ score: 1 }))).toBeNull();
  });
});

describe("explanation authorship", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  it("says who wrote the explanation", () => {
    expect(explanationNote({ explanationBy: "claude", explanationUpdatedAt: "2026-11-08T09:00:00Z" }, now)).toBe(
      "Drafted by Claude from your test · 2 days ago",
    );
    expect(explanationNote({ explanationBy: "you", explanationUpdatedAt: "2026-11-10T09:00:00Z" }, now)).toBe(
      "Edited by you · today",
    );
    expect(explanationNote({ explanationBy: null, explanationUpdatedAt: null }, now)).toBeNull();
  });

  it("labels history entries by source", () => {
    expect(eventLabel({ kind: "explanation", source: "mcp" })).toBe("Explanation drafted by Claude");
    expect(eventLabel({ kind: "explanation", source: "web" })).toBe("Explanation edited");
    expect(eventLabel({ kind: "claude_test", source: "mcp" })).toBe("Claude test");
  });
});

describe("links in the deck", () => {
  const ref = (t: TopicView) => ({ id: t.id, term: t.term });
  // Server order (priority): Agents, RAG, Embeddings, Evals. Agents builds on RAG builds on Embeddings.
  const embeddings = topic({ id: "e", term: "Embeddings" });
  const rag = topic({ id: "r", term: "RAG", buildsOn: [ref(embeddings)] });
  const agents = topic({ id: "a", term: "Agents", buildsOn: [ref(rag)] });
  const evals = topic({ id: "v", term: "Evals", score: 4 });
  const deck = [agents, rag, embeddings, evals];

  it("puts prerequisites first in Prep now and nowhere else", () => {
    expect(shownIn("prep", deck).map((t) => t.term)).toEqual(["Embeddings", "RAG", "Agents"]);
    expect(shownIn("all", deck).map((t) => t.term)).toEqual(["Agents", "RAG", "Embeddings", "Evals"]);
    expect(shownIn("confident", deck).map((t) => t.term)).toEqual(["Evals"]);
  });

  it("offers other topics as prerequisites, blocking the ones that would make a loop", () => {
    // RAG already builds on Embeddings (left out), and Agents builds on RAG (blocked).
    expect(prerequisiteOptions(rag, deck, "").options).toEqual([
      { id: "v", term: "Evals", blocked: null },
      { id: "a", term: "Agents", blocked: "builds on RAG" },
    ]);
    // Embeddings sits under both, so neither can become its prerequisite.
    expect(prerequisiteOptions(embeddings, deck, "").options.map((o) => [o.term, o.blocked !== null])).toEqual([
      ["Evals", false],
      ["Agents", true],
      ["RAG", true],
    ]);
    expect(prerequisiteOptions(agents, deck, "EMB").options).toEqual([{ id: "e", term: "Embeddings", blocked: null }]);
    expect(prerequisiteOptions(agents, deck, "zzz")).toEqual({ options: [], more: 0 });
  });

  it("shows a few options and counts the rest", () => {
    const many = Array.from({ length: 10 }, (_, i) => topic({ id: `t${i}`, term: `Topic ${i}` }));
    const found = prerequisiteOptions(agents, [...deck, ...many], "topic");
    expect(found.options).toHaveLength(6);
    expect(found.more).toBe(4);
  });
});
