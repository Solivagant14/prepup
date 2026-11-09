/**
 * One HTTP service, two doors into the same core: REST for the web app and
 * MCP for Claude. Both sit behind the same token check.
 */
import { randomBytes } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { OAuthProvider } from "@prepup/contracts";
import { DomainError, type Actor, type PrepUpService } from "@prepup/core";
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Authenticator } from "./auth.js";
import { consentCsp, consentPage } from "./consent.js";
import { createMcpServer } from "./mcp.js";

export interface AppOptions {
  service: PrepUpService;
  auth: Authenticator;
  publicUrl: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  /** Tells the web app whether to show Supabase sign-in or use local dev auth. */
  authMode?: "supabase" | "dev";
  /** Social sign-in buttons to show on the web app and consent page. */
  oauthProviders?: OAuthProvider[];
}

type Env = { Variables: { actor: Actor } };

const STATUS: Record<DomainError["code"], ContentfulStatusCode> = { invalid: 400, not_found: 404, rule: 422 };

export function createApp(opts: AppOptions) {
  const app = new Hono<Env>();
  const metadataUrl = `${opts.publicUrl}/.well-known/oauth-protected-resource/mcp`;

  app.onError((err, c) => {
    if (err instanceof DomainError) return c.json({ error: err.code, message: err.message }, STATUS[err.code]);
    console.error(err);
    return c.json({ error: "internal", message: "Something went wrong" }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // Public settings the web app needs before sign-in. The publishable key is
  // designed to be public; nothing secret is returned here.
  app.get("/app-config", (c) =>
    c.json({
      authMode: opts.authMode ?? "supabase",
      supabaseUrl: opts.supabaseUrl ?? null,
      supabasePublishableKey: opts.supabasePublishableKey ?? null,
      providers: opts.oauthProviders ?? [],
    }),
  );

  // OAuth protected-resource metadata (RFC 9728): tells Claude which
  // authorization server issues tokens for this API.
  const protectedResource = (c: Context) =>
    c.json({
      resource: `${opts.publicUrl}/mcp`,
      authorization_servers: opts.supabaseUrl ? [`${opts.supabaseUrl}/auth/v1`] : [],
      bearer_methods_supported: ["header"],
      resource_name: "PrepUp",
    });
  app.get("/.well-known/oauth-protected-resource", protectedResource);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResource);

  app.get("/oauth/consent", (c) => {
    if (!opts.supabaseUrl || !opts.supabasePublishableKey) {
      return c.text("Consent page is not configured (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)", 503);
    }
    const nonce = randomBytes(16).toString("base64");
    c.header("Content-Security-Policy", consentCsp(opts.supabaseUrl, nonce));
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    return c.html(consentPage(opts.supabaseUrl, opts.supabasePublishableKey, nonce, opts.oauthProviders ?? []));
  });

  // Everything below needs a valid token. A 401 carries the metadata URL so
  // an MCP client can discover how to sign in.
  const requireUser = async (c: Context<Env>, next: () => Promise<void>) => {
    const user = await opts.auth.authenticate(c.req.raw);
    if (!user) {
      c.header("WWW-Authenticate", `Bearer resource_metadata="${metadataUrl}"`);
      return c.json({ error: "unauthorized", message: "Sign in to PrepUp" }, 401);
    }
    c.set("actor", await opts.service.resolveActor(user.userId));
    await next();
  };
  app.use("/api/*", requireUser);
  app.use("/mcp", requireUser);

  const svc = opts.service;
  app.get("/api/topics", async (c) =>
    c.json(await svc.listTopics(c.var.actor, { filter: c.req.query("filter") ?? "all", limit: Number(c.req.query("limit") ?? 500) })),
  );
  app.post("/api/topics", async (c) => {
    const { topic, created } = await svc.addTopic(c.var.actor, await body(c));
    return c.json(topic, created ? 201 : 200);
  });
  app.get("/api/topics/:id", async (c) => c.json(await svc.getTopic(c.var.actor, uuidParam(c))));
  app.patch("/api/topics/:id", async (c) => c.json(await svc.updateTopic(c.var.actor, uuidParam(c), await body(c), "web")));
  app.put("/api/topics/:id/score", async (c) => c.json(await svc.setScore(c.var.actor, uuidParam(c), await body(c), "web")));
  app.delete("/api/topics/:id", async (c) => c.json({ deleted: await svc.deleteTopic(c.var.actor, uuidParam(c)) }));
  app.get("/api/topics/:id/history", async (c) => c.json(await svc.history(c.var.actor, uuidParam(c))));

  // Stateless Streamable HTTP: a fresh MCP server per request, bound to the
  // signed-in user. No session state to lose when a machine restarts.
  app.post("/mcp", async (c) => {
    const server = createMcpServer(svc, c.var.actor);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close();
    }
  });
  const methodNotAllowed = (c: Context) =>
    c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, 405);
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidParam(c: Context): string {
  const id = c.req.param("id") ?? "";
  if (!UUID.test(id)) throw new DomainError("not_found", "Topic not found");
  return id;
}

async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new DomainError("invalid", "Request body must be JSON");
  }
}
