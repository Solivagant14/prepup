/**
 * The Vercel function entry. Vercel calls this Node-style handler per request;
 * the app (and its database pool) is created once per warm instance and reused.
 * Our MCP server is stateless, so nothing needs to survive between requests.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { bootstrap } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { restorePath } from "./vercel-path.js";

const { app } = bootstrap(loadConfig({ DB_POOL_MAX: "1", ...process.env }));
const listener = getRequestListener(app.fetch);

export default function handler(req: IncomingMessage, res: ServerResponse) {
  req.url = restorePath(req.url);
  return listener(req, res);
}
