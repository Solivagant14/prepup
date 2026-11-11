/**
 * One HTTP service, two doors into the same core: REST for the web app and
 * MCP for Claude. Both sit behind the same token check.
 */
import { randomBytes } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { DEFAULT_MAX_TOPICS, type HostStatusView, type HostUsage, type OAuthProvider } from "@prepup/contracts";
import { DomainError, FIXED_RULES, STYLE_PRESETS, type Actor, type PrepUpService } from "@prepup/core";
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Authenticator } from "./auth.js";
import { consentCsp, consentPage } from "./consent.js";
import { createMcpServer, describeConnector, testingStyleFor } from "./mcp.js";
import { checkRateLimit, type RateLimitOptions } from "./rate-limit.js";

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
  /** Per-user request limits. Left out, nothing is limited (unit tests). */
  rateLimit?: RateLimitOptions;
  /** What the public costs page says about this host. Left out, it reads as a free copy with no support link. */
  host?: HostOptions;
}

export interface HostOptions {
  monthlyCostUsd?: number;
  supportUrl?: string;
  sourceUrl?: string;
  databaseLimitMb?: number;
  maxTopics?: number;
}

const DEFAULT_SOURCE_URL = "https://github.com/Solivagant14/prepup";
/** How long the usage totals are reused. The page is public, so it mustn't cost a database query per visit. */
const USAGE_TTL_MS = 5 * 60_000;

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
      supportUrl: opts.host?.supportUrl ?? null,
      sourceUrl: opts.host?.sourceUrl ?? DEFAULT_SOURCE_URL,
    }),
  );

  // The public costs page: what this host pays, how full it is, and each person's
  // limits. Totals only. Anyone can call it, so the totals are kept for a few
  // minutes here and by the CDN in front.
  let usage: { at: number; value: Promise<HostUsage> } | null = null;
  const currentUsage = () => {
    const now = Date.now();
    if (!usage || now - usage.at > USAGE_TTL_MS) {
      const value = opts.service.hostUsage();
      const entry = { at: now, value };
      // A failed read isn't kept, so the next visit tries again.
      value.catch(() => {
        if (usage === entry) usage = null;
      });
      usage = entry;
    }
    return usage.value;
  };
  app.get("/host-status", async (c) => {
    const status: HostStatusView = {
      monthlyCostUsd: opts.host?.monthlyCostUsd ?? 0,
      supportUrl: opts.host?.supportUrl ?? null,
      sourceUrl: opts.host?.sourceUrl ?? DEFAULT_SOURCE_URL,
      usage: await currentUsage(),
      databaseLimitBytes: (opts.host?.databaseLimitMb ?? 500) * 1024 * 1024,
      limits: {
        topicsPerPerson: opts.host?.maxTopics ?? DEFAULT_MAX_TOPICS,
        requestsPerMinute: opts.rateLimit?.perMinute ?? null,
        requestsPerDay: opts.rateLimit?.perDay ?? null,
      },
    };
    c.header("Cache-Control", "public, max-age=60, s-maxage=300");
    return c.json(status);
  });

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
    if (opts.rateLimit) {
      const limit = await checkRateLimit(opts.rateLimit, user.userId);
      if (!limit.ok) {
        c.header("Retry-After", String(limit.retryAfterSeconds));
        return c.json({ error: "rate_limited", message: limit.message }, 429);
      }
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

  // "Builds on" links. Both answer with the topic as it now stands.
  app.post("/api/topics/:id/links", async (c) => {
    const { topic, created } = await svc.linkTopics(c.var.actor, uuidParam(c), await body(c));
    return c.json(topic, created ? 201 : 200);
  });
  app.delete("/api/topics/:id/links/:buildsOnId", async (c) =>
    c.json((await svc.unlinkTopics(c.var.actor, uuidParam(c), uuidParam(c, "buildsOnId"))).topic),
  );

  // Personal settings, and everything the "Claude setup" page shows. The tool
  // list and rules come from the same definitions the MCP server uses.
  app.get("/api/settings", async (c) => c.json(await svc.getSettings(c.var.actor)));
  app.put("/api/settings", async (c) => c.json(await svc.updateSettings(c.var.actor, await body(c))));
  app.get("/api/connector", async (c) =>
    c.json({
      url: `${opts.publicUrl}/mcp`,
      ...describeConnector(),
      fixedRules: FIXED_RULES.map(({ id, title, rule, why }) => ({ id, title, rule, why })),
      presets: STYLE_PRESETS,
      settings: await svc.getSettings(c.var.actor),
    }),
  );

  // "Erase all my data". Web only on purpose: Claude has no tool for it.
  app.delete("/api/account", async (c) => {
    await svc.deleteAccount(c.var.actor);
    return c.json({ deleted: true });
  });

  // Stateless Streamable HTTP: a fresh MCP server per request, bound to the
  // signed-in user. No session state to lose when a machine restarts.
  app.post("/mcp", async (c) => {
    // The style only travels in the instructions, which a client reads once, when it
    // connects. Every other call skips the lookup.
    const style = (await isInitialize(c.req.raw)) ? await testingStyleFor(svc, c.var.actor) : undefined;
    const server = createMcpServer(svc, c.var.actor, style);
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

async function isInitialize(request: Request): Promise<boolean> {
  try {
    const message = (await request.clone().json()) as { method?: unknown } | Array<{ method?: unknown }>;
    return (Array.isArray(message) ? message : [message]).some((m) => m?.method === "initialize");
  } catch {
    return false;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidParam(c: Context, name = "id"): string {
  const id = c.req.param(name) ?? "";
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
