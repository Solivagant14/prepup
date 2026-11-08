/** Long-running server for local development (and any container host). */
import { serve } from "@hono/node-server";
import { bootstrap } from "./bootstrap.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app, close } = bootstrap(config);

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
