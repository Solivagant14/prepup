import type { TopicView } from "@prepup/contracts";
import { describe, expect, it } from "vitest";
import { cardLook, freshnessText, matches, mix, prefersLightText, RAMP, summarize } from "../src/lib/deck.js";

const topic = (over: Partial<TopicView>): TopicView => ({
  id: "t",
  term: "RAG",
  sourceUrl: null,
  importance: "medium",
  explanation: "",
  score: 1,
  level: "Shaky",
  createdAt: "2026-11-01T00:00:00Z",
  lastTestedAt: null,
  daysUntilDrop: null,
  fadingSoon: false,
  fadingThisWeek: false,
  priority: 0,
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
