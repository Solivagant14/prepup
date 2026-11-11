/**
 * Four screens, each with its own address, without a router library: the
 * path picks the screen, and the browser's back button works as usual.
 */
import { useSyncExternalStore } from "react";

export type Screen = "deck" | "claude" | "account" | "costs";

export const PATHS: Record<Screen, string> = { deck: "/", claude: "/claude", account: "/account", costs: "/costs" };

/** What the browser tab says on each screen. */
export const TITLES: Record<Screen, string> = {
  deck: "PrepUp",
  claude: "Claude setup · PrepUp",
  account: "Account · PrepUp",
  costs: "Costs · PrepUp",
};

/** The screen an address shows, or null for an address PrepUp doesn't have. */
export function screenFor(pathname: string): Screen | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const found = (Object.keys(PATHS) as Screen[]).find((s) => PATHS[s] === clean);
  return found ?? null;
}

/**
 * Screens used to live after a "#" (`/#/claude`). Returns the address such a
 * link means now, or null for any other hash, such as the one a sign-in
 * provider sends people back with.
 */
export function legacyPath(hash: string): string | null {
  const match = /^#\/(claude|costs)?$/.exec(hash);
  if (!match) return null;
  return match[1] ? `/${match[1]}` : "/";
}

/** Call once before the first render, so an old link opens the right screen. */
export function adoptLegacyAddress(): void {
  const path = legacyPath(window.location.hash);
  if (path) window.history.replaceState(null, "", path);
}

const CHANGED = "popstate";

/** Goes to another screen without reloading the page. */
export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent(CHANGED));
  if (!opts.replace) window.scrollTo(0, 0);
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}
