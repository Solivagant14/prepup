import type { TopicView } from "@prepup/contracts";
import { describe, expect, it } from "vitest";
import {
  fitView,
  keepInReach,
  layoutGraph,
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_H,
  NODE_W,
  openingView,
  READABLE_ZOOM,
  zoomAt,
} from "../src/lib/graph.js";

const topic = (id: string, buildsOn: string[] = []): TopicView => ({
  id,
  term: id,
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
  buildsOn: buildsOn.map((b) => ({ id: b, term: b })),
  neededFor: [],
});

const at = (layout: ReturnType<typeof layoutGraph>, id: string) => layout.nodes.find((n) => n.topic.id === id)!;
const overlaps = (layout: ReturnType<typeof layoutGraph>) =>
  layout.nodes.some((a, i) =>
    layout.nodes.some((b, j) => i < j && Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H),
  );

describe("graph layout", () => {
  it("puts each topic to the right of everything it builds on", () => {
    const layout = layoutGraph([
      topic("Agents", ["RAG"]),
      topic("RAG", ["Embeddings", "Vector databases"]),
      topic("Embeddings"),
      topic("Vector databases"),
    ]);
    expect(at(layout, "Embeddings").x).toBe(0);
    expect(at(layout, "Vector databases").x).toBe(0);
    expect(at(layout, "RAG").x).toBeGreaterThan(at(layout, "Embeddings").x + NODE_W);
    expect(at(layout, "Agents").x).toBeGreaterThan(at(layout, "RAG").x + NODE_W);
    // RAG sits level with the middle of its two prerequisites.
    expect(at(layout, "RAG").y).toBe((at(layout, "Embeddings").y + at(layout, "Vector databases").y) / 2);
    expect(layout.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(["Embeddings>RAG", "RAG>Agents", "Vector databases>RAG"]);
    expect(layout.unlinkedLabel).toBeNull();
    expect(overlaps(layout)).toBe(false);
  });

  it("uses the longest chain for the column, so a shortcut link never points backwards", () => {
    // Agents builds on RAG and, directly, on Embeddings.
    const layout = layoutGraph([topic("Agents", ["RAG", "Embeddings"]), topic("RAG", ["Embeddings"]), topic("Embeddings")]);
    expect([at(layout, "Embeddings").x, at(layout, "RAG").x, at(layout, "Agents").x]).toEqual(
      [...[at(layout, "Embeddings").x, at(layout, "RAG").x, at(layout, "Agents").x]].sort((a, b) => a - b),
    );
    expect(new Set(layout.nodes.map((n) => n.x)).size).toBe(3);
  });

  it("routes a link that skips a column between the topics there, not behind them", () => {
    // Agents builds on Embeddings directly, two columns away, with RAG and Chunking in the column between.
    const layout = layoutGraph([
      topic("Agents", ["RAG", "Embeddings", "Chunking"]),
      topic("RAG", ["Embeddings"]),
      topic("Chunking", ["Embeddings"]),
      topic("Embeddings"),
    ]);
    const long = layout.edges.find((e) => e.from === "Embeddings" && e.to === "Agents")!;
    // The path crosses the middle column on a straight run ("H"), at a height no topic in that column occupies.
    const laneY = Number(long.path.match(/,([\d.]+) H/)![1]);
    for (const id of ["RAG", "Chunking"]) {
      const n = at(layout, id);
      expect(laneY < n.y || laneY > n.y + NODE_H).toBe(true);
    }
    expect(layout.edges.find((e) => e.from === "RAG")!.path).not.toContain("H");
    expect(overlaps(layout)).toBe(false);
  });

  it("keeps separate groups in separate bands and unlinked topics in a grid underneath", () => {
    const layout = layoutGraph([
      topic("Loose 1"),
      topic("RAG", ["Embeddings"]),
      topic("Embeddings"),
      topic("Loose 2"),
      topic("Context window", ["Tokens"]),
      topic("Tokens"),
      topic("Agents", ["RAG"]),
      topic("Loose 3"),
    ]);
    const linkedBottom = Math.max(...layout.nodes.filter((n) => n.linked).map((n) => n.y + NODE_H));
    const loose = layout.nodes.filter((n) => !n.linked);
    expect(loose.map((n) => n.topic.id)).toEqual(["Loose 1", "Loose 2", "Loose 3"]);
    expect(Math.min(...loose.map((n) => n.y))).toBeGreaterThan(linkedBottom);
    expect(layout.unlinkedLabel).toMatchObject({ count: 3 });
    expect(layout.unlinkedLabel!.y).toBeGreaterThan(linkedBottom);
    // The bigger group comes first, and the two never share a row.
    expect(at(layout, "Tokens").y).toBeGreaterThan(at(layout, "Embeddings").y);
    expect(overlaps(layout)).toBe(false);
    for (const n of layout.nodes) {
      expect(n.x + NODE_W).toBeLessThanOrEqual(layout.width);
      expect(n.y + NODE_H).toBeLessThanOrEqual(layout.height);
    }
  });

  it("untangles arrows where it can", () => {
    // A1 feeds B1 and A2 feeds B2; names alone would put the B column upside down.
    const layout = layoutGraph([topic("A1"), topic("A2"), topic("Zed", ["A1"]), topic("Bee", ["A2"])]);
    expect(at(layout, "A1").y < at(layout, "A2").y).toBe(at(layout, "Zed").y < at(layout, "Bee").y);
  });

  it("lays out a deck with no links as a plain grid, with no heading", () => {
    const layout = layoutGraph(Array.from({ length: 7 }, (_, i) => topic(`T${i}`)));
    expect(layout.edges).toEqual([]);
    expect(layout.unlinkedLabel).toBeNull();
    expect(at(layout, "T0")).toMatchObject({ x: 0, y: 0 });
    expect(new Set(layout.nodes.map((n) => n.y)).size).toBeGreaterThan(1);
    expect(overlaps(layout)).toBe(false);
  });

  it("copes with an empty deck, a link to a missing topic, a loop and a big deck", () => {
    expect(layoutGraph([])).toEqual({ nodes: [], edges: [], width: 0, height: 0, unlinkedLabel: null });
    const dangling = layoutGraph([topic("RAG", ["Gone"])]);
    expect(dangling.edges).toEqual([]);
    expect(dangling.nodes).toHaveLength(1);
    const loop = layoutGraph([topic("A", ["B"]), topic("B", ["A"])]);
    expect(loop.nodes).toHaveLength(2);
    expect(overlaps(loop)).toBe(false);

    const big = Array.from({ length: 500 }, (_, i) => topic(`T${i}`, i % 5 ? [`T${i - 1}`] : i >= 10 ? [`T${i - 10}`] : []));
    const started = performance.now();
    const layout = layoutGraph(big);
    expect(performance.now() - started).toBeLessThan(500);
    expect(layout.nodes).toHaveLength(500);
    expect(overlaps(layout)).toBe(false);
  });
});

describe("moving the board", () => {
  const board = { width: 1000, height: 400 };
  it("fits the whole board in view without enlarging it", () => {
    expect(fitView(board, { width: 548, height: 600 })).toEqual({ k: 0.5, x: 24, y: 200 });
    expect(fitView({ width: 200, height: 100 }, { width: 600, height: 400 })).toEqual({ k: 1, x: 200, y: 150 });
    // A huge board stops at the smallest zoom and starts from its top-left corner.
    expect(fitView({ width: 20000, height: 9000 }, { width: 390, height: 500 })).toEqual({ k: MIN_ZOOM, x: 24, y: 24 });
    expect(fitView({ width: 0, height: 0 }, { width: 390, height: 500 }).k).toBe(1);
  });

  it("opens readable: the whole board if it fits, otherwise its top-left corner at a legible size", () => {
    expect(openingView({ width: 600, height: 300 }, { width: 800, height: 500 })).toEqual(fitView({ width: 600, height: 300 }, { width: 800, height: 500 }));
    expect(openingView({ width: 1200, height: 700 }, { width: 358, height: 560 })).toEqual({ k: READABLE_ZOOM, x: 16, y: 70 });
    expect(openingView({ width: 1200, height: 2000 }, { width: 358, height: 560 })).toEqual({ k: READABLE_ZOOM, x: 16, y: 16 });
  });

  it("zooms around the point under the cursor and stops at the limits", () => {
    const v = zoomAt({ x: 100, y: 50, k: 1 }, 2, 300, 150);
    expect(v).toEqual({ k: 2, x: -100, y: -50 });
    // The board point that was under (300, 150) still is.
    expect([(300 - v.x) / v.k, (150 - v.y) / v.k]).toEqual([200, 100]);
    expect(zoomAt(v, 10, 0, 0).k).toBe(MAX_ZOOM);
    expect(zoomAt(v, 0.001, 0, 0).k).toBe(MIN_ZOOM);
  });

  it("never lets the board be dragged out of reach", () => {
    const box = { width: 600, height: 400 };
    expect(keepInReach({ x: 5000, y: 5000, k: 1 }, board, box)).toEqual({ k: 1, x: 528, y: 328 });
    expect(keepInReach({ x: -5000, y: -5000, k: 1 }, board, box)).toEqual({ k: 1, x: -928, y: -328 });
    expect(keepInReach({ x: 10, y: -20, k: 1 }, board, box)).toEqual({ x: 10, y: -20, k: 1 });
  });
});
