/**
 * The scoring rules, as pure functions. Everything here is computed at read
 * time from stored events, so nothing needs a cron job and the rules can
 * change without migrating data.
 */
import { LEVEL_NAMES, type Importance, type Score } from "@prepup/contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A card loses one step for every 14 days without a Claude test. */
export const FADE_PERIOD_DAYS = 14;
/** The countdown bar appears in the last 3 days before a drop. */
export const COUNTDOWN_DAYS = 3;
export const WEEK_DAYS = 7;

const IMPORTANCE_WEIGHT: Record<Importance, number> = { high: 3, medium: 2, low: 1 };

export interface ScoreInputs {
  /** The latest stored score (from a Claude test or a manual edit), or null if never scored. */
  lastScore: { score: Score; at: Date } | null;
  /** When the card was last tested by Claude. Only this resets the fade clock. */
  lastTestAt: Date | null;
  createdAt: Date;
  now: Date;
}

export interface ScoreState {
  score: Score;
  daysUntilDrop: number | null;
  fadingSoon: boolean;
  fadingThisWeek: boolean;
}

const clampScore = (n: number): Score => Math.min(5, Math.max(1, n)) as Score;

/**
 * Drops are pinned to a fixed schedule: every 14 days after the last Claude
 * test (or after creation, if never tested). A manual edit sets the score
 * you see now but does not move that schedule, so the next drop still comes
 * when it would have.
 */
export function computeScore({ lastScore, lastTestAt, createdAt, now }: ScoreInputs): ScoreState {
  const period = FADE_PERIOD_DAYS * DAY_MS;
  const anchor = (lastTestAt ?? createdAt).getTime();
  const base = lastScore ?? { score: 1 as Score, at: createdAt };
  const periodsAt = (t: number) => Math.floor(Math.max(0, t - anchor) / period);

  const drops = periodsAt(now.getTime()) - periodsAt(base.at.getTime());
  const score = clampScore(base.score - Math.max(0, drops));

  if (score === 1) {
    return { score, daysUntilDrop: null, fadingSoon: false, fadingThisWeek: false };
  }
  const nextDrop = anchor + (periodsAt(now.getTime()) + 1) * period;
  const daysUntilDrop = Math.max(1, Math.ceil((nextDrop - now.getTime()) / DAY_MS));
  return {
    score,
    daysUntilDrop,
    fadingSoon: daysUntilDrop <= COUNTDOWN_DAYS,
    fadingThisWeek: daysUntilDrop <= WEEK_DAYS,
  };
}

export const levelName = (score: Score) => LEVEL_NAMES[score - 1]!;

/** Higher = study sooner: important and weak first, plus a nudge for cards about to drop. */
export function priority(importance: Importance, state: Pick<ScoreState, "score" | "fadingSoon">): number {
  return IMPORTANCE_WEIGHT[importance] * (5 - state.score) + (state.fadingSoon ? 2 : 0);
}

/**
 * Turns "LangChain", "lang chain" and "Lang-Chain" into the same key, so the
 * same buzzword captured twice merges into one card.
 */
export function normalizeTerm(term: string): string {
  const compact = term.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return compact || term.trim().toLowerCase();
}
