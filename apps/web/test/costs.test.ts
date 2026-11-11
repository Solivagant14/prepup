import { describe, expect, it } from "vitest";
import { databaseRoom, formatBytes, formatUsd, plural, supportLabel } from "../src/lib/costs.js";

const MB = 1024 * 1024;
const usage = (databaseBytes: number | null) => ({ people: 3, topics: 40, databaseBytes });

describe("costs page sums", () => {
  it("writes sizes short enough to sit beside a bar", () => {
    expect(formatBytes(8.44 * MB)).toBe("8.4 MB");
    expect(formatBytes(212.6 * MB)).toBe("213 MB");
    expect(formatBytes(500 * MB)).toBe("500 MB");
    expect(formatBytes(8 * 1024 * MB)).toBe("8.0 GB");
  });

  it("writes whole dollars without cents", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(45)).toBe("$45");
    expect(formatUsd(12.5)).toBe("$12.50");
  });

  it("shows how full the database is, and flags it from 80%", () => {
    expect(databaseRoom({ usage: usage(50 * MB), databaseLimitBytes: 500 * MB })).toEqual({
      usedLabel: "50 MB",
      limitLabel: "500 MB",
      percent: 10,
      nearlyFull: false,
    });
    expect(databaseRoom({ usage: usage(400 * MB), databaseLimitBytes: 500 * MB })).toMatchObject({ percent: 80, nearlyFull: true });
  });

  it("never draws a bar past full", () => {
    expect(databaseRoom({ usage: usage(900 * MB), databaseLimitBytes: 500 * MB })).toMatchObject({ percent: 100, nearlyFull: true });
  });

  it("shows no bar when the host can't measure its database", () => {
    expect(databaseRoom({ usage: usage(null), databaseLimitBytes: 500 * MB })).toBeNull();
  });

  it("counts one thing in the singular", () => {
    expect(plural(1, "topic", "topics")).toBe("1 topic");
    expect(plural(5000, "request", "requests")).toBe("5,000 requests");
  });

  it("names the support link after where it goes", () => {
    expect(supportLabel("https://buymeacoffee.com/someone")).toBe("Buy me a coffee");
    expect(supportLabel("https://www.buymeacoffee.com/someone")).toBe("Buy me a coffee");
    expect(supportLabel("https://github.com/sponsors/someone")).toBe("Sponsor on GitHub");
    expect(supportLabel("https://example.org/donate")).toBe("Support this host");
    expect(supportLabel("not a url")).toBe("Support this host");
  });
});
