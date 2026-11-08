import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.js";
import type { Db } from "./repository.js";

/** Where the SQL migrations live. Overridable for the bundled production build. */
export const defaultMigrationsDir = () =>
  process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL("../migrations", import.meta.url));

export function createDb(databaseUrl: string): { db: Db; close: () => Promise<void> } {
  // prepare: false keeps this compatible with Supabase's connection pooler.
  const sql = postgres(databaseUrl, { prepare: false, max: 5 });
  return { db: drizzle(sql, { schema }) as unknown as Db, close: () => sql.end() };
}

export async function runMigrations(databaseUrl: string, migrationsFolder = defaultMigrationsDir()) {
  const sql = postgres(databaseUrl, { prepare: false, max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end();
  }
}
