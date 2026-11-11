/**
 * Plain text matching between terms: what "similar topics" and search_topics
 * use. No embeddings and no AI; PrepUp only compares letters and words, and
 * leaves the judgement about what really builds on what to the user's Claude.
 */
import { normalizeTerm } from "./scoring.js";

/** Too common to mean two terms are related. */
const FILLER = new Set(["the", "and", "for", "with", "from", "into", "that", "this", "are", "was", "has", "not"]);

const words = (term: string): string[] =>
  term
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** From this length up, a word also matches a longer word that starts with it: "embedding" and "embeddings". */
const STEM_LENGTH = 4;

const sameWord = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= STEM_LENGTH && (a.startsWith(b) || b.startsWith(a)));

/**
 * How strongly two terms overlap; 0 means not at all. One term inside the
 * other ("Embedding" in "Embedding models") beats shared words ("Vector
 * search" and "Vector databases", or "Embedding models" and "Embeddings").
 * `minLength` is the shortest overlap that counts, so a one-letter term
 * doesn't match everything.
 */
export function overlap(a: string, b: string, minLength: number): number {
  const [x, y] = [normalizeTerm(a), normalizeTerm(b)];
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= minLength && long.includes(short)) return 100 + short.length;
  const counts = (w: string) => w.length >= minLength && !FILLER.has(w);
  const other = words(b).filter(counts);
  const shared = words(a).filter((w) => counts(w) && other.some((o) => sameWord(w, o)));
  return new Set(shared).size;
}

/** The items whose term overlaps `text`, best match first, then by name. */
export function bestMatches<T extends { term: string }>(text: string, items: readonly T[], limit: number, minLength: number): T[] {
  return items
    .map((item) => ({ item, score: overlap(text, item.term, minLength) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.item.term.localeCompare(b.item.term))
    .slice(0, limit)
    .map((m) => m.item);
}
