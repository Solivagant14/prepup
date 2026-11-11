/**
 * "Builds on" links, as pure functions over plain pairs. Links must form a
 * DAG (a directed graph with no loops): RAG can build on Embeddings, but then
 * Embeddings can't build on RAG, directly or through other topics.
 *
 * Nothing here touches a database or a runtime library, so the web app
 * imports this file too (as @prepup/core/links) and gets the same answers
 * as the server.
 */

/** One link: `topicId` builds on `buildsOnId`. */
export interface LinkPair {
  topicId: string;
  buildsOnId: string;
}

function prerequisiteMap(links: readonly LinkPair[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const l of links) {
    const list = map.get(l.topicId);
    if (list) list.push(l.buildsOnId);
    else map.set(l.topicId, [l.buildsOnId]);
  }
  return map;
}

/**
 * The chain of "builds on" steps from one topic down to another, both ends
 * included, or null if there is none. A topic reaches itself.
 */
export function pathBetween(links: readonly LinkPair[], from: string, to: string): string[] | null {
  const prerequisites = prerequisiteMap(links);
  const cameFrom = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    if (id === to) {
      const path: string[] = [];
      for (let at: string | null = id; at !== null; at = cameFrom.get(at) ?? null) path.unshift(at);
      return path;
    }
    for (const next of prerequisites.get(id) ?? []) {
      if (!cameFrom.has(next)) {
        cameFrom.set(next, id);
        queue.push(next);
      }
    }
  }
  return null;
}

/**
 * Why `topicId` can't build on `buildsOnId`: the existing chain that already
 * leads from the prerequisite back to the topic. Null means the link is safe.
 */
export function loopPath(links: readonly LinkPair[], topicId: string, buildsOnId: string): string[] | null {
  return pathBetween(links, buildsOnId, topicId);
}

/** Every topic that builds on this one, directly or through others. Linking to any of them would make a loop. */
export function dependentsOf(links: readonly LinkPair[], topicId: string): Set<string> {
  const flipped = links.map((l) => ({ topicId: l.buildsOnId, buildsOnId: l.topicId }));
  const prerequisites = prerequisiteMap(flipped);
  const seen = new Set<string>();
  const queue = [topicId];
  for (let i = 0; i < queue.length; i++) {
    for (const next of prerequisites.get(queue[i]!) ?? []) {
      if (!seen.has(next) && next !== topicId) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * Reorders a list so every topic comes after the topics it builds on, changing
 * as little else as possible: walk the list in its own order and, just before
 * each topic, pull forward any of its prerequisites that haven't appeared yet.
 * Prerequisites that aren't in the list are skipped, but the chain through
 * them still counts (A builds on B builds on C: C still goes before A when B
 * isn't listed).
 */
export function prerequisitesFirst<T extends { id: string }>(items: readonly T[], links: readonly LinkPair[]): T[] {
  if (links.length === 0) return [...items];
  const prerequisites = prerequisiteMap(links);
  const position = new Map(items.map((item, i) => [item.id, i]));
  const byId = new Map(items.map((item) => [item.id, item]));
  const inListOrder = (a: string, b: string) => (position.get(a) ?? Infinity) - (position.get(b) ?? Infinity);
  const visited = new Set<string>();
  const out: T[] = [];
  // Iterative, so a long chain can't overflow the stack; `visited` also makes it safe if a loop ever got in.
  const place = (root: string) => {
    const stack: Array<{ id: string; next: string[] }> = [];
    const open = (id: string) => {
      visited.add(id);
      stack.push({ id, next: [...(prerequisites.get(id) ?? [])].sort(inListOrder) });
    };
    open(root);
    while (stack.length > 0) {
      const top = stack.at(-1)!;
      const next = top.next.shift();
      if (next === undefined) {
        stack.pop();
        const item = byId.get(top.id);
        if (item) out.push(item);
      } else if (!visited.has(next)) {
        open(next);
      }
    }
  };
  for (const item of items) if (!visited.has(item.id)) place(item.id);
  return out;
}
