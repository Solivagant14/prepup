/**
 * How a card looks, derived from its score. The deck darkens as you learn:
 * pale for Shaky, deep indigo for Can explain. While a card goes unreviewed
 * it slowly pales toward the level below; the countdown bar appears only in
 * the last 3 days before a drop.
 */
import type { Importance, TopicView } from "@prepup/contracts";

export const LEVELS = ["Shaky", "Learning", "Getting there", "Confident", "Can explain"] as const;
export const RAMP = ["#EEF0FF", "#C9CEFC", "#A5ACF8", "#4F46E5", "#312E81"] as const;
const FADE_DAYS = 14;
const COUNTDOWN_DAYS = 3;

const hex = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)) as [number, number, number];

export function mix(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  return `#${x.map((v, k) => Math.round(v + (y[k]! - v) * t).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function luminance(h: string): number {
  const c = hex(h).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** True when white text contrasts better than near-black (#18181B) on this background. */
export function prefersLightText(bg: string): boolean {
  const l = luminance(bg);
  return 1.05 / (l + 0.05) > (l + 0.05) / 0.0597;
}

export interface CardLook {
  background: string;
  border: string;
  ink: string;
  lightText: boolean;
  /** 0–1 share of the countdown bar still filled, or null when no countdown shows. */
  countdown: number | null;
  countdownColor: string;
}

export function cardLook(t: Pick<TopicView, "score" | "daysUntilDrop" | "fadingSoon">): CardLook {
  const base = RAMP[t.score - 1]!;
  let background: string = base;
  if (t.score >= 2 && t.daysUntilDrop !== null) {
    const elapsed = Math.min(Math.max(FADE_DAYS - t.daysUntilDrop, 0), FADE_DAYS);
    background = mix(base, RAMP[t.score - 2]!, (elapsed / FADE_DAYS) * 0.8);
  }
  const lightText = prefersLightText(background);
  return {
    background,
    border: t.score <= 2 ? "var(--line)" : background,
    ink: lightText ? "#FFFFFF" : "#18181B",
    lightText,
    countdown: t.fadingSoon && t.daysUntilDrop !== null ? Math.min(t.daysUntilDrop / COUNTDOWN_DAYS, 1) : null,
    countdownColor: lightText ? "#F4A7BC" : "#BE4C6A",
  };
}

export type Tab = "all" | "prep" | "fading_week" | "confident";

export const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Every topic, most urgent first. The darker your deck, the more you know." },
  { id: "prep", label: "Prep now", hint: "Your weakest topics (score 1–2), most important first." },
  { id: "fading_week", label: "Fading this week", hint: "Drops a level within 7 days unless Claude tests you on it." },
  { id: "confident", label: "Confident", hint: "Topics at 4 or 5." },
];

const MATCH: Record<Tab, (t: TopicView) => boolean> = {
  all: () => true,
  prep: (t) => t.score <= 2,
  fading_week: (t) => t.fadingThisWeek,
  confident: (t) => t.score >= 4,
};

export const matches = (tab: Tab, t: TopicView) => MATCH[tab](t);

export interface Summary {
  total: number;
  confident: number;
  confidentPct: number;
  byLevel: { name: (typeof LEVELS)[number]; color: string; count: number }[];
  prep: number;
  fadingWeek: number;
}

export function summarize(topics: TopicView[]): Summary {
  const confident = topics.filter(MATCH.confident).length;
  return {
    total: topics.length,
    confident,
    confidentPct: topics.length ? Math.round((confident / topics.length) * 100) : 0,
    byLevel: LEVELS.map((name, i) => ({ name, color: RAMP[i]!, count: topics.filter((t) => t.score === i + 1).length })),
    prep: topics.filter(MATCH.prep).length,
    fadingWeek: topics.filter(MATCH.fading_week).length,
  };
}

export function freshnessText(t: Pick<TopicView, "score" | "daysUntilDrop" | "fadingSoon">): string | null {
  if (t.daysUntilDrop === null) return null;
  const n = t.daysUntilDrop;
  const unit = n === 1 ? "day" : "days";
  return t.fadingSoon ? `Drops to ${LEVELS[t.score - 2]} in ${n} ${unit}` : `Fresh for ${n} more ${unit}`;
}

export function daysAgo(iso: string, now = Date.now()): string {
  const d = Math.floor((now - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

export const testPrompt = (term: string) =>
  `Use PrepUp to test me on "${term}" like an FDE interviewer, then suggest a score for me to confirm.`;

export const IMPORTANCES: Importance[] = ["high", "medium", "low"];
