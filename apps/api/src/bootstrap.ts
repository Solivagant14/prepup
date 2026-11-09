/** Builds the app from config. Shared by the long-running server and the Vercel function. */
import { PrepUpService } from "@prepup/core";
import { createDb, PostgresRepository } from "@prepup/db";
import { createApp } from "./app.js";
import { DevAuthenticator, SupabaseAuthenticator } from "./auth.js";
import type { Config } from "./config.js";

export function bootstrap(config: Config) {
  const { db, close } = createDb(config.DATABASE_URL, config.DB_POOL_MAX);
  const service = new PrepUpService(new PostgresRepository(db));
  const auth = config.AUTH_MODE === "dev" ? new DevAuthenticator() : new SupabaseAuthenticator(config.SUPABASE_URL!);
  const app = createApp({
    service,
    auth,
    publicUrl: config.PUBLIC_URL,
    authMode: config.AUTH_MODE,
    ...(config.SUPABASE_URL ? { supabaseUrl: config.SUPABASE_URL } : {}),
    ...(config.SUPABASE_PUBLISHABLE_KEY ? { supabasePublishableKey: config.SUPABASE_PUBLISHABLE_KEY } : {}),
  });
  return { app, close };
}
