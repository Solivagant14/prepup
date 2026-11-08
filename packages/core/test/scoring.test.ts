import { describe, expect, it } from "vitest";
import { computeScore, normalizeTerm, priority } from "../src/scoring.js";

const day = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * 86_400_000);

describe("computeScore", () => {
  it("starts a new card at 1, which cannot fade", () => {
    const s = computeScore({ lastScore: null, lastTestAt: null, createdAt: day(0), now: day(40) });
    expect(s).toEqual({ score: 1, daysUntilDrop: null, fadingSoon: false, fadingThisWeek: false });
  });

  it("drops one step for every 14 days after a Claude test", () => {
    const tested = { lastScore: { score: 4 as const, at: day(0) }, lastTestAt: day(0), createdAt: day(0) };
    expect(computeScore({ ...tested, now: day(13) }).score).toBe(4);
    expect(computeScore({ ...tested, now: day(14) }).score).toBe(3);
    expect(computeScore({ ...tested, now: day(28) }).score).toBe(2);
    expect(computeScore({ ...tested, now: day(400) }).score).toBe(1);
  });

  it("counts down only in the last 3 days, and flags the last week", () => {
    const tested = { lastScore: { score: 3 as const, at: day(0) }, lastTestAt: day(0), createdAt: day(0) };
    expect(computeScore({ ...tested, now: day(6) })).toMatchObject({ daysUntilDrop: 8, fadingSoon: false, fadingThisWeek: false });
    expect(computeScore({ ...tested, now: day(7) })).toMatchObject({ daysUntilDrop: 7, fadingSoon: false, fadingThisWeek: true });
    expect(computeScore({ ...tested, now: day(11) })).toMatchObject({ daysUntilDrop: 3, fadingSoon: true });
  });

  it("shows a manual edit right away, but keeps the drop schedule from the last test", () => {
    // Tested at day 0 with 2; on day 10 the user manually sets 4.
    const inputs = { lastScore: { score: 4 as const, at: day(10) }, lastTestAt: day(0), createdAt: day(0) };
    expect(computeScore({ ...inputs, now: day(10) })).toMatchObject({ score: 4, daysUntilDrop: 4 });
    // The drop still lands on day 14, as it would have without the edit.
    expect(computeScore({ ...inputs, now: day(14) }).score).toBe(3);
  });

  it("does not apply drops that happened before a manual edit", () => {
    // Tested at day 0, untouched until day 30 (two drops), then set to 4 by hand.
    const inputs = { lastScore: { score: 4 as const, at: day(30) }, lastTestAt: day(0), createdAt: day(0) };
    expect(computeScore({ ...inputs, now: day(30) }).score).toBe(4);
    expect(computeScore({ ...inputs, now: day(42) }).score).toBe(3);
  });

  it("uses the creation date as the schedule when never tested", () => {
    const inputs = { lastScore: { score: 3 as const, at: day(2) }, lastTestAt: null, createdAt: day(0) };
    expect(computeScore({ ...inputs, now: day(13) }).score).toBe(3);
    expect(computeScore({ ...inputs, now: day(14) }).score).toBe(2);
  });
});

describe("priority", () => {
  it("puts important, weak and nearly-fading cards first", () => {
    expect(priority("high", { score: 1, fadingSoon: false })).toBe(12);
    expect(priority("low", { score: 1, fadingSoon: false })).toBe(4);
    expect(priority("high", { score: 4, fadingSoon: true })).toBe(5);
    expect(priority("high", { score: 5, fadingSoon: false })).toBe(0);
  });
});

describe("normalizeTerm", () => {
  it("merges spelling variants of the same buzzword", () => {
    expect(normalizeTerm("LangChain")).toBe(normalizeTerm("lang chain"));
    expect(normalizeTerm("Lang-Chain ")).toBe("langchain");
    expect(normalizeTerm("RAG")).toBe(normalizeTerm("rag"));
  });

  it("keeps non-Latin terms instead of emptying them", () => {
    expect(normalizeTerm("トークン")).toBe("トークン");
    expect(normalizeTerm("!!!")).toBe("!!!");
  });
});
