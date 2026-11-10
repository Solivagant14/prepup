/** Builds the app from config. Shared by the long-running server and the Vercel function. */
import { PrepUpService } from "@prepup/core";
import { createDb, PostgresRateLimitStore, PostgresRepository } from "@prepup/db";
import { createApp } from "./app.js";
import { DevAuthenticator, SupabaseAuthenticator } from "./auth.js";
import type { Config } from "./config.js";

export function bootstrap(config: Config) {
  const { db, close } = createDb(config.DATABASE_URL, config.DB_POOL_MAX);
  const service = new PrepUpService(new PostgresRepository(db), undefined, { maxTopics: config.MAX_TOPICS_PER_USER });
  const auth = config.AUTH_MODE === "dev" ? new DevAuthenticator() : new SupabaseAuthenticator(config.SUPABASE_URL!, undefined, config.AUTH_AUDIENCE);
  const app = createApp({
    service,
    auth,
    publicUrl: config.PUBLIC_URL,
    authMode: config.AUTH_MODE,
    oauthProviders: config.AUTH_PROVIDERS,
    rateLimit: {
      store: new PostgresRateLimitStore(db),
      perMinute: config.RATE_LIMIT_PER_MINUTE,
      perDay: config.RATE_LIMIT_PER_DAY,
    },
    ...(config.SUPABASE_URL ? { supabaseUrl: config.SUPABASE_URL } : {}),
    ...(config.SUPABASE_PUBLISHABLE_KEY ? { supabasePublishableKey: config.SUPABASE_PUBLISHABLE_KEY } : {}),
  });
  return { app, close };
}
