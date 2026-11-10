/**
 * Per-user request limits, so one runaway client (a Claude loop, a script)
 * can't use up the shared free tier. Two windows: a minute, for bursts, and
 * a day, which bounds how much one account can write.
 */
export interface RateLimitStore {
  /** Counts this request and returns the totals for the current minute and day. */
  hit(userId: string, now: Date): Promise<{ minute: number; day: number }>;
}

export interface RateLimitOptions {
  store: RateLimitStore;
  perMinute: number;
  perDay: number;
  now?: () => Date;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number; message: string };

export async function checkRateLimit(opts: RateLimitOptions, userId: string): Promise<RateLimitResult> {
  const now = (opts.now ?? (() => new Date()))();
  let counts: { minute: number; day: number };
  try {
    counts = await opts.store.hit(userId, now);
  } catch (err) {
    // Fail open: a broken counter (say, the table isn't migrated yet) must not take the app down.
    console.error("Rate limit check failed; allowing the request", err);
    return { ok: true };
  }
  const ms = now.getTime();
  if (counts.day > opts.perDay) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((86_400_000 - (ms % 86_400_000)) / 1000),
      message: "Daily request limit reached. It resets at midnight UTC.",
    };
  }
  if (counts.minute > opts.perMinute) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((60_000 - (ms % 60_000)) / 1000),
      message: "Too many requests. Wait a minute and try again.",
    };
  }
  return { ok: true };
}

/** For local development and tests. Counts live in this process only. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private rows = new Map<string, { minuteStart: number; minute: number; dayStart: number; day: number }>();

  async hit(userId: string, now: Date) {
    const minuteStart = Math.floor(now.getTime() / 60_000);
    const dayStart = Math.floor(now.getTime() / 86_400_000);
    const row = this.rows.get(userId);
    const next = {
      minuteStart,
      minute: row?.minuteStart === minuteStart ? row.minute + 1 : 1,
      dayStart,
      day: row?.dayStart === dayStart ? row.day + 1 : 1,
    };
    this.rows.set(userId, next);
    return { minute: next.minute, day: next.day };
  }
}
