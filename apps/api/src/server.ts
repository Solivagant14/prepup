import { serve } from "@hono/node-server";
import { PrepUpService } from "@prepup/core";
import { createDb, PostgresRepository } from "@prepup/db";
import { createApp } from "./app.js";
import { DevAuthenticator, SupabaseAuthenticator } from "./auth.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL, config.DB_POOL_MAX);
const service = new PrepUpService(new PostgresRepository(db));
const auth = config.AUTH_MODE === "dev" ? new DevAuthenticator() : new SupabaseAuthenticator(config.SUPABASE_URL!);

const app = createApp({
  service,
  auth,
  publicUrl: config.PUBLIC_URL,
  ...(config.SUPABASE_URL ? { supabaseUrl: config.SUPABASE_URL } : {}),
  ...(config.SUPABASE_PUBLISHABLE_KEY ? { supabasePublishableKey: config.SUPABASE_PUBLISHABLE_KEY } : {}),
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`PrepUp API on :${info.port} (auth: ${config.AUTH_MODE})`);
  if (config.AUTH_MODE === "dev") console.warn("AUTH_MODE=dev: requests are trusted by x-dev-user-id. Local use only.");
});

const shutdown = () => {
  server.close();
  void close().finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
