/** The sums behind the costs page, kept apart from the page so they can be tested. */
import type { HostStatusView } from "@prepup/contracts";

const MB = 1024 * 1024;

/** "8.4 MB", "212 MB", "1.2 GB": short enough to sit beside a bar. */
export function formatBytes(bytes: number): string {
  const mb = bytes / MB;
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

export function formatUsd(amount: number): string {
  return `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

/** At this share of the database limit the host should be planning its next step. */
export const NEARLY_FULL = 0.8;

export interface DatabaseRoom {
  usedLabel: string;
  limitLabel: string;
  /** 0 to 100, for the bar. */
  percent: number;
  nearlyFull: boolean;
}

/** How full the database is, or null when the host can't measure it. */
export function databaseRoom(status: Pick<HostStatusView, "usage" | "databaseLimitBytes">): DatabaseRoom | null {
  const used = status.usage.databaseBytes;
  if (used === null || status.databaseLimitBytes <= 0) return null;
  const share = used / status.databaseLimitBytes;
  return {
    usedLabel: formatBytes(used),
    limitLabel: formatBytes(status.databaseLimitBytes),
    percent: Math.min(100, Math.max(0, Math.round(share * 100))),
    nearlyFull: share >= NEARLY_FULL,
  };
}

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Names the support link after where it goes, since a host can use any service. */
export function supportLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "buymeacoffee.com") return "Buy me a coffee";
    if (host === "github.com") return "Sponsor on GitHub";
    if (host === "ko-fi.com") return "Support on Ko-fi";
  } catch {
    // Not a URL we can read: fall through to the plain label.
  }
  return "Support this host";
}
