import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appFor, APPS, cursorConfig, GUIDE, GUIDE_GROUPS, guidePageFor, guidePath, neighbours, PHRASES } from "../src/lib/guide.js";
import { FIRST_TEST_PROMPT } from "../src/lib/deck.js";
import { screenFor } from "../src/lib/route.js";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the guide's contents", () => {
  it("has eight pages, each with its own address", () => {
    expect(GUIDE).toHaveLength(9);
    expect(new Set(GUIDE.map((p) => p.slug)).size).toBe(GUIDE.length);
    for (const p of GUIDE) {
      expect(p.slug).toMatch(/^[a-z-]+$/);
      expect(screenFor(guidePath(p.slug))).toBe("guide");
      expect(guidePageFor(guidePath(p.slug))).toBe(p);
    }
  });

  it("keeps each group's pages together, in the order the groups are listed", () => {
    const order = GUIDE.map((p) => GUIDE_GROUPS.indexOf(p.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(GUIDE.map((p) => p.group))).toEqual(new Set(GUIDE_GROUPS));
  });

  it("has a written page for every entry, and no page without an entry", () => {
    const source = read("../src/components/guide/pages.tsx");
    const table = source.slice(source.indexOf("export const PAGES"));
    const slugs = [...table.matchAll(/^\s+"?([a-z-]+)"?: [A-Z]\w+,$/gm)].map((m) => m[1]);
    expect(slugs.sort()).toEqual(GUIDE.map((p) => p.slug).sort());
  });

  it("opens the first page at /guide and has no page for an unknown address", () => {
    expect(guidePageFor("/guide")).toBe(GUIDE[0]);
    expect(guidePageFor("/guide/")).toBe(GUIDE[0]);
    expect(guidePageFor("/guide/nope")).toBeNull();
    expect(guidePageFor("/settings")).toBeNull();
  });

  it("links each page to the ones before and after it", () => {
    expect(neighbours(GUIDE[0]!.slug)).toEqual({ prev: null, next: GUIDE[1] });
    expect(neighbours(GUIDE[3]!.slug)).toEqual({ prev: GUIDE[2], next: GUIDE[4] });
    expect(neighbours(GUIDE.at(-1)!.slug)).toEqual({ prev: GUIDE.at(-2), next: null });
    expect(neighbours("nope")).toEqual({ prev: null, next: null });
  });
});

describe("connecting an app", () => {
  it("marks only Claude as tested", () => {
    expect(APPS.filter((a) => a.tested).map((a) => a.id)).toEqual(["claude"]);
    expect(APPS.map((a) => a.id)).toEqual(["claude", "chatgpt", "cursor", "vscode", "other"]);
  });

  it("opens the app a link names, and the first app otherwise", () => {
    expect(appFor("?app=cursor")).toBe("cursor");
    expect(appFor("?app=other")).toBe("other");
    expect(appFor("")).toBe("claude");
    expect(appFor("?app=notepad")).toBe("claude");
  });

  it("writes Cursor's settings with the connector's own address", () => {
    expect(JSON.parse(cursorConfig("https://prepup.example.com/mcp"))).toEqual({
      mcpServers: { prepup: { url: "https://prepup.example.com/mcp" } },
    });
  });

  it("uses one phrase for a first test everywhere", () => {
    expect(PHRASES.test).toBe(FIRST_TEST_PROMPT);
  });
});

describe("wording", () => {
  // The app talks about "your assistant". One AI app is named only where its own steps are.
  const NAMED = ["components/guide/pages.tsx", "lib/guide.ts"];
  const files = [
    "App.tsx",
    "components/Costs.tsx",
    "components/Deck.tsx",
    "components/GetStarted.tsx",
    "components/Guide.tsx",
    "components/HostLinks.tsx",
    "components/Settings.tsx",
    "components/Shell.tsx",
    "components/SignIn.tsx",
    "components/TestingStyle.tsx",
    "components/Toast.tsx",
    "components/TopicCard.tsx",
    "components/TopicDialog.tsx",
    "components/Tracker.tsx",
    "components/GraphBoard.tsx",
    "lib/deck.ts",
    "lib/route.ts",
    "lib/account.ts",
    "lib/costs.ts",
  ];

  it("names no one AI app outside the connect steps", () => {
    for (const file of files) {
      expect(NAMED).not.toContain(file);
      // Internal values such as the "claude_test" event kind are lower case and stay.
      expect(read(`../src/${file}`), file).not.toMatch(/Claude|ChatGPT|Cursor\b|VS Code/);
    }
  });
});
