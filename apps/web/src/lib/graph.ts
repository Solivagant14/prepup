/**
 * Where everything sits in the graph view. Pure geometry: topics in, boxes
 * and arrows out, so it can be tested without a browser.
 *
 * Linked topics are drawn as a path that reads left to right: a topic sits
 * one column to the right of the furthest thing it builds on. Each connected
 * group gets its own band, largest first. Topics with no links wait in a
 * grid underneath, so nothing in the deck is hidden.
 */
import type { TopicView } from "@prepup/contracts";
import { linkPairs } from "./deck.js";

export const NODE_W = 176;
export const NODE_H = 64;
const COLUMN_GAP = 84;
const ROW_GAP = 16;
const GROUP_GAP = 44;
const GRID_GAP = 14;
const LABEL_H = 34;
/** Height of the lane a long link takes through a column it only passes. */
const LANE_H = 18;
/** Sweeps that untangle arrows by pulling each topic towards its neighbours. */
const SWEEPS = 6;

export interface GraphNode {
  topic: TopicView;
  x: number;
  y: number;
  linked: boolean;
}

export interface GraphEdge {
  /** The prerequisite: the arrow starts here. */
  from: string;
  /** The topic that builds on it: the arrow ends here. */
  to: string;
  path: string;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  /** Where the "Not linked yet" heading goes, or null when every topic is linked (or none is). */
  unlinkedLabel: { x: number; y: number; count: number } | null;
}

export function layoutGraph(topics: TopicView[]): GraphLayout {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const links = linkPairs(topics).filter((l) => byId.has(l.topicId) && byId.has(l.buildsOnId));
  const prerequisites = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string) => map.set(key, [...(map.get(key) ?? []), value]);
  for (const l of links) {
    push(prerequisites, l.topicId, l.buildsOnId);
    push(dependents, l.buildsOnId, l.topicId);
  }
  const linkedIds = new Set(links.flatMap((l) => [l.topicId, l.buildsOnId]));

  // Column = the longest chain of prerequisites under a topic. `open` guards against a loop that should never exist.
  const column = new Map<string, number>();
  const open = new Set<string>();
  const columnOf = (id: string): number => {
    const known = column.get(id);
    if (known !== undefined) return known;
    if (open.has(id)) return 0;
    open.add(id);
    const depth = Math.max(-1, ...(prerequisites.get(id) ?? []).map(columnOf)) + 1;
    open.delete(id);
    column.set(id, depth);
    return depth;
  };

  // Connected groups, each laid out on its own.
  const groupOf = new Map<string, number>();
  const groups: string[][] = [];
  for (const id of topics.map((t) => t.id).filter((id) => linkedIds.has(id))) {
    if (groupOf.has(id)) continue;
    const members: string[] = [];
    const queue = [id];
    groupOf.set(id, groups.length);
    for (let i = 0; i < queue.length; i++) {
      const at = queue[i]!;
      members.push(at);
      for (const next of [...(prerequisites.get(at) ?? []), ...(dependents.get(at) ?? [])]) {
        if (!groupOf.has(next)) {
          groupOf.set(next, groups.length);
          queue.push(next);
        }
      }
    }
    groups.push(members);
  }
  const term = (id: string) => byId.get(id)!.term;
  groups.sort((a, b) => b.length - a.length || term(a[0]!).localeCompare(term(b[0]!)));

  const nodes: GraphNode[] = [];
  const place = new Map<string, { x: number; y: number }>();
  /** For a link that crosses whole columns: the lane it takes through each one, as a y per column. */
  const lanes = new Map<string, number[]>();
  const linkKey = (l: { topicId: string; buildsOnId: string }) => `${l.buildsOnId}>${l.topicId}`;
  let top = 0;
  let width = 0;
  groups.forEach((members, g) => {
    const sparse: string[][] = [];
    for (const id of members) (sparse[columnOf(id)] ??= []).push(id);
    // Only a loop (which the server refuses) could leave a column empty; close the gap if one ever does.
    const columns = Array.from(sparse, (c) => c ?? []).filter((c) => c.length > 0);
    const at = new Map<string, number>();
    columns.forEach((c, i) => c.forEach((id) => at.set(id, i)));

    // A link that skips columns gets a thin lane of its own in each column it crosses, so its line runs
    // between the topics there instead of behind them. Lanes are ordered along with the topics.
    const before = new Map<string, string[]>();
    const after = new Map<string, string[]>();
    const join = (left: string, right: string) => {
      push(after, left, right);
      push(before, right, left);
    };
    const waypoints = new Map<string, string[]>();
    for (const l of links) {
      if (groupOf.get(l.topicId) !== groupOf.get(members[0]!)) continue;
      const [from, to] = [at.get(l.buildsOnId)!, at.get(l.topicId)!];
      const chain = [l.buildsOnId];
      for (let c = from + 1; c < to; c++) {
        const lane = `lane:${g}:${linkKey(l)}:${c}`;
        columns[c]!.push(lane);
        chain.push(lane);
      }
      chain.push(l.topicId);
      waypoints.set(linkKey(l), chain.slice(1, -1));
      for (let i = 1; i < chain.length; i++) join(chain[i - 1]!, chain[i]!);
    }
    const isLane = (id: string) => !byId.has(id);
    const name = (id: string) => (isLane(id) ? id : term(id));
    for (const c of columns) c.sort((a, b) => Number(isLane(a)) - Number(isLane(b)) || name(a).localeCompare(name(b)));

    // Order each column by the average row of its neighbours in the column before (then after), a few times over.
    const row = new Map<string, number>();
    const index = () => columns.forEach((c) => c.forEach((id, i) => row.set(id, i - (c.length - 1) / 2)));
    index();
    const pull = (c: string[], neighbours: Map<string, string[]>) => {
      const weight = (id: string) => {
        const near = neighbours.get(id) ?? [];
        return near.length ? near.reduce((sum, n) => sum + row.get(n)!, 0) / near.length : row.get(id)!;
      };
      const weights = new Map(c.map((id) => [id, weight(id)]));
      c.sort((a, b) => weights.get(a)! - weights.get(b)! || name(a).localeCompare(name(b)));
    };
    for (let sweep = 0; sweep < SWEEPS; sweep++) {
      const forward = sweep % 2 === 0;
      const order = forward ? columns.slice(1) : columns.slice(0, -1).reverse();
      for (const c of order) {
        pull(c, forward ? before : after);
        index();
      }
    }

    const slot = (id: string) => (isLane(id) ? LANE_H : NODE_H);
    const tall = (c: string[]) => c.reduce((sum, id) => sum + slot(id) + ROW_GAP, -ROW_GAP);
    const bandHeight = Math.max(...columns.map(tall));
    const laneY = new Map<string, number>();
    columns.forEach((c, ci) => {
      let y = top + (bandHeight - tall(c)) / 2;
      for (const id of c) {
        if (isLane(id)) laneY.set(id, y + LANE_H / 2);
        else {
          const spot = { x: ci * (NODE_W + COLUMN_GAP), y };
          place.set(id, spot);
          nodes.push({ topic: byId.get(id)!, ...spot, linked: true });
        }
        y += slot(id) + ROW_GAP;
      }
    });
    for (const [key, chain] of waypoints) lanes.set(key, chain.map((lane) => laneY.get(lane)!));
    width = Math.max(width, columns.length * (NODE_W + COLUMN_GAP) - COLUMN_GAP);
    top += bandHeight + GROUP_GAP;
  });
  let height = groups.length ? top - GROUP_GAP : 0;

  // Everything else, in the order the deck gave (most urgent first).
  const unlinked = topics.filter((t) => !linkedIds.has(t.id));
  let unlinkedLabel: GraphLayout["unlinkedLabel"] = null;
  if (unlinked.length > 0) {
    const fits = Math.floor((width + GRID_GAP) / (NODE_W + GRID_GAP));
    const perRow = Math.min(unlinked.length, Math.max(fits, Math.min(4, Math.ceil(Math.sqrt(unlinked.length * 2)))));
    let gridTop = 0;
    if (groups.length > 0) {
      unlinkedLabel = { x: 0, y: height + GROUP_GAP, count: unlinked.length };
      gridTop = height + GROUP_GAP + LABEL_H;
    }
    unlinked.forEach((topic, i) => {
      nodes.push({
        topic,
        x: (i % perRow) * (NODE_W + GRID_GAP),
        y: gridTop + Math.floor(i / perRow) * (NODE_H + GRID_GAP),
        linked: false,
      });
    });
    const rows = Math.ceil(unlinked.length / perRow);
    width = Math.max(width, perRow * (NODE_W + GRID_GAP) - GRID_GAP);
    height = gridTop + rows * (NODE_H + GRID_GAP) - GRID_GAP;
  }

  const bend = COLUMN_GAP / 2;
  const edges = links.map((l): GraphEdge => {
    const a = place.get(l.buildsOnId)!;
    const b = place.get(l.topicId)!;
    let [x, y] = [a.x + NODE_W, a.y + NODE_H / 2];
    let path = `M${x},${y}`;
    const curveTo = (x2: number, y2: number) => {
      path += ` C${x + bend},${y} ${x2 - bend},${y2} ${x2},${y2}`;
      [x, y] = [x2, y2];
    };
    for (const laneY of lanes.get(linkKey(l)) ?? []) {
      curveTo(x + COLUMN_GAP, laneY);
      // Straight across the column, in the lane kept free for it.
      x += NODE_W;
      path += ` H${x}`;
    }
    curveTo(b.x, b.y + NODE_H / 2);
    return { from: l.buildsOnId, to: l.topicId, path };
  });

  return { nodes, edges, width, height, unlinkedLabel };
}

export interface View {
  /** Screen position of the board's top-left corner, in pixels. */
  x: number;
  y: number;
  /** Zoom: 1 is actual size. */
  k: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/** Below this the names are too small to read, so the board doesn't open any smaller than this. */
export const READABLE_ZOOM = 0.6;

/**
 * The view the board opens with: everything in view if that stays readable,
 * otherwise readable and starting from the top-left corner, where each path begins.
 */
export function openingView(layout: Pick<GraphLayout, "width" | "height">, box: { width: number; height: number }): View {
  const whole = fitView(layout, box);
  if (whole.k >= READABLE_ZOOM) return whole;
  const pad = 16;
  return {
    k: READABLE_ZOOM,
    x: Math.max(pad, (box.width - layout.width * READABLE_ZOOM) / 2),
    y: Math.max(pad, (box.height - layout.height * READABLE_ZOOM) / 2),
  };
}

/** The view that shows the whole board, centred, never enlarged past actual size. */
export function fitView(layout: Pick<GraphLayout, "width" | "height">, box: { width: number; height: number }, padding = 24): View {
  if (layout.width === 0 || layout.height === 0) return { x: padding, y: padding, k: 1 };
  const k = clamp(
    Math.min((box.width - padding * 2) / layout.width, (box.height - padding * 2) / layout.height),
    MIN_ZOOM,
    1,
  );
  return {
    k,
    x: Math.max(padding, (box.width - layout.width * k) / 2),
    y: Math.max(padding, (box.height - layout.height * k) / 2),
  };
}

/** Zooms by `factor` while the board point under (cx, cy) stays under it. */
export function zoomAt(view: View, factor: number, cx: number, cy: number): View {
  const k = clamp(view.k * factor, MIN_ZOOM, MAX_ZOOM);
  const ratio = k / view.k;
  return { k, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio };
}

/** Keeps part of the board on screen, so it can't be dragged out of reach. */
export function keepInReach(view: View, layout: Pick<GraphLayout, "width" | "height">, box: { width: number; height: number }, margin = 72): View {
  return {
    k: view.k,
    x: clamp(view.x, margin - layout.width * view.k, box.width - margin),
    y: clamp(view.y, margin - layout.height * view.k, box.height - margin),
  };
}
