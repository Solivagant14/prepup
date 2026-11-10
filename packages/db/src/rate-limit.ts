/**
 * Request counters in Postgres. One upsert per request: it starts a new
 * window when the minute or day has rolled over, otherwise adds one, and
 * returns both counts. A single row per user, so there is nothing to clean up.
 */
import { sql } from "drizzle-orm";
import type { Db } from "./repository.js";
import { rateLimits } from "./schema.js";

export class PostgresRateLimitStore {
  constructor(private readonly db: Db) {}

  async hit(userId: string, now: Date): Promise<{ minute: number; day: number }> {
    const minuteStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const dayStart = new Date(Math.floor(now.getTime() / 86_400_000) * 86_400_000);
    const [row] = await this.db
      .insert(rateLimits)
      .values({ userId, minuteStart, minuteCount: 1, dayStart, dayCount: 1 })
      .onConflictDoUpdate({
        target: rateLimits.userId,
        set: {
          minuteCount: sql`CASE WHEN ${rateLimits.minuteStart} = excluded.minute_start THEN ${rateLimits.minuteCount} + 1 ELSE 1 END`,
          minuteStart: sql`excluded.minute_start`,
          dayCount: sql`CASE WHEN ${rateLimits.dayStart} = excluded.day_start THEN ${rateLimits.dayCount} + 1 ELSE 1 END`,
          dayStart: sql`excluded.day_start`,
        },
      })
      .returning({ minute: rateLimits.minuteCount, day: rateLimits.dayCount });
    return row!;
  }
}
