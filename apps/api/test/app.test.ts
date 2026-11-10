import { InMemoryRepository, PrepUpService } from "@prepup/core";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { DevAuthenticator, SupabaseAuthenticator } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { InMemoryRateLimitStore, type RateLimitStore } from "../src/rate-limit.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PUBLIC_URL = "https://prepup.example.com";
const SUPABASE_URL = "https://abc.supabase.co";

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp({
    service: new PrepUpService(new InMemoryRepository()),
    auth: new DevAuthenticator(),
    publicUrl: PUBLIC_URL,
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: "sb_publishable_test",
  });
});

const as = (user: string, init: RequestInit = {}) => ({
  ...init,
  headers: { "content-type": "application/json", "x-dev-user-id": user, ...(init.headers ?? {}) },
});

let rpcId = 0;
async function mcp(user: string, method: string, params: Record<string, unknown> = {}) {
  const res = await app.request(
    "/mcp",
    as(user, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { result?: any; error?: any };
}

describe("discovery and auth", () => {
  it("publishes protected-resource metadata pointing at Supabase Auth", async () => {
    const res = await app.request("/.well-known/oauth-protected-resource/mcp");
    expect(await res.json()).toMatchObject({
      resource: `${PUBLIC_URL}/mcp`,
      authorization_servers: [`${SUPABASE_URL}/auth/v1`],
    });
  });

  it("answers unauthenticated MCP calls with a 401 that says where to sign in", async () => {
    const res = await app.request("/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it("serves the consent page with a strict, nonce-based CSP", async () => {
    const res = await app.request("/oauth/consent?authorization_id=abc");
    const csp = res.headers.get("content-security-policy") ?? "";
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    expect(res.status).toBe(200);
    expect(nonce).toBeTruthy();
    expect(csp).not.toContain("unsafe-inline");
    const html = await res.text();
    expect(html).toContain(`nonce="${nonce}"`);
    expect(html).not.toMatch(/ style="/);
  });

  it("refuses dev auth in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", AUTH_MODE: "dev", DATABASE_URL: "postgres://x" })).toThrow(
      /refused in production/,
    );
  });
});

describe("SupabaseAuthenticator", () => {
  it("accepts tokens signed by the project's keys and rejects the rest", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: "ES256", kid: "k1" }] });
    const auth = new SupabaseAuthenticator(SUPABASE_URL, jwks);
    const sign = (claims: Record<string, unknown>, issuer = `${SUPABASE_URL}/auth/v1`) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "ES256", kid: "k1" })
        .setIssuer(issuer)
        .setSubject(USER)
        .setExpirationTime("5m")
        .sign(privateKey);
    const req = (token: string) => new Request("https://x/mcp", { headers: { authorization: `Bearer ${token}` } });

    const user = { role: "authenticated", aud: "authenticated" };
    expect(await auth.authenticate(req(await sign({ ...user, client_id: "claude" })))).toEqual({
      userId: USER,
      clientId: "claude",
    });
    expect(await auth.authenticate(req(await sign(user, "https://evil.example/auth/v1")))).toBeNull();
    expect(await auth.authenticate(req(await sign({ ...user, role: "anon" })))).toBeNull();
    // The audience must be the one Supabase gives signed-in users: missing or different is refused.
    expect(await auth.authenticate(req(await sign({ role: "authenticated" })))).toBeNull();
    expect(await auth.authenticate(req(await sign({ ...user, aud: "some-other-api" })))).toBeNull();
    expect(await auth.authenticate(req(await sign({ ...user, aud: ["some-other-api", "authenticated"] })))).not.toBeNull();
    expect(await auth.authenticate(req("not-a-jwt"))).toBeNull();
    expect(await auth.authenticate(new Request("https://x/mcp"))).toBeNull();
  });
});

describe("REST", () => {
  it("adds, edits and lists topics for the signed-in user only", async () => {
    const created = await app.request("/api/topics", as(USER, { method: "POST", body: JSON.stringify({ term: "RAG" }) }));
    expect(created.status).toBe(201);
    const topic = (await created.json()) as { id: string };

    const dup = await app.request("/api/topics", as(USER, { method: "POST", body: JSON.stringify({ term: "rag" }) }));
    expect(dup.status).toBe(200);

    const scored = await app.request(`/api/topics/${topic.id}/score`, as(USER, { method: "PUT", body: JSON.stringify({ score: 3 }) }));
    expect(await scored.json()).toMatchObject({ score: 3, level: "Getting there" });

    expect(await (await app.request("/api/topics", as(USER))).json()).toHaveLength(1);
    expect(await (await app.request("/api/topics", as(OTHER))).json()).toHaveLength(0);
    expect((await app.request(`/api/topics/${topic.id}`, as(OTHER))).status).toBe(404);
  });

  it("deletes a topic for its owner only", async () => {
    const created = await app.request("/api/topics", as(USER, { method: "POST", body: JSON.stringify({ term: "LoRA" }) }));
    const { id } = (await created.json()) as { id: string };
    expect((await app.request(`/api/topics/${id}`, as(OTHER, { method: "DELETE" }))).status).toBe(404);
    const res = await app.request(`/api/topics/${id}`, as(USER, { method: "DELETE" }));
    expect(await res.json()).toEqual({ deleted: { term: "LoRA" } });
    expect((await app.request(`/api/topics/${id}`, as(USER))).status).toBe(404);
  });

  it("returns readable validation errors", async () => {
    const res = await app.request("/api/topics", as(USER, { method: "POST", body: JSON.stringify({ term: "" }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid" });
    expect((await app.request("/api/topics/not-a-uuid", as(USER))).status).toBe(404);
  });
});

describe("hardening", () => {
  const limited = (store: RateLimitStore, now: () => Date, perMinute = 2, perDay = 3) =>
    createApp({
      service: new PrepUpService(new InMemoryRepository()),
      auth: new DevAuthenticator(),
      publicUrl: PUBLIC_URL,
      rateLimit: { store, perMinute, perDay, now },
    });

  it("limits each user per minute and per day, on REST and MCP alike", async () => {
    let now = new Date("2026-11-01T09:00:30Z");
    const app = limited(new InMemoryRateLimitStore(), () => now);
    const get = (user: string, path = "/api/topics") => app.request(path, as(user));

    expect((await get(USER)).status).toBe(200);
    expect((await get(USER)).status).toBe(200);
    const blocked = await app.request("/mcp", as(USER, { method: "POST", body: "{}" }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("30");
    expect(await blocked.json()).toMatchObject({ error: "rate_limited" });
    expect((await get(OTHER)).status).toBe(200);

    // A new minute lifts the burst limit, but the blocked call still counted toward the day.
    now = new Date("2026-11-01T09:01:00Z");
    const daily = await get(USER);
    expect(daily.status).toBe(429);
    expect(await daily.json()).toMatchObject({ message: expect.stringContaining("Daily") });
    now = new Date("2026-11-02T00:00:00Z");
    expect((await get(USER)).status).toBe(200);
  });

  it("doesn't count requests without a valid sign-in, and stays up if the counter breaks", async () => {
    const hits: string[] = [];
    const store: RateLimitStore = {
      hit: async (userId) => {
        hits.push(userId);
        throw new Error("relation \"rate_limits\" does not exist");
      },
    };
    const app = limited(store, () => new Date());
    expect((await app.request("/api/topics")).status).toBe(401);
    expect(hits).toEqual([]);
    expect((await app.request("/api/topics", as(USER))).status).toBe(200);
    expect(hits).toEqual([USER]);
  });

  it("reports a full deck as a rule, not a crash", async () => {
    const app = createApp({
      service: new PrepUpService(new InMemoryRepository(), undefined, { maxTopics: 1 }),
      auth: new DevAuthenticator(),
      publicUrl: PUBLIC_URL,
    });
    const add = (term: string) => app.request("/api/topics", as(USER, { method: "POST", body: JSON.stringify({ term }) }));
    expect((await add("RAG")).status).toBe(201);
    const full = await add("MCP");
    expect(full.status).toBe(422);
    expect(await full.json()).toMatchObject({ error: "rule", message: expect.stringContaining("deck is full") });
  });

  it("deletes the signed-in user's data and only theirs", async () => {
    const add = (user: string) => app.request("/api/topics", as(user, { method: "POST", body: JSON.stringify({ term: "RAG" }) }));
    await add(USER);
    await add(OTHER);
    expect((await app.request("/api/account", { method: "DELETE" })).status).toBe(401);
    const res = await app.request("/api/account", as(USER, { method: "DELETE" }));
    expect(await res.json()).toEqual({ deleted: true });
    expect(await (await app.request("/api/topics", as(USER))).json()).toEqual([]);
    expect(await (await app.request("/api/topics", as(OTHER))).json()).toHaveLength(1);
  });

  it("has safe defaults for limits and rejects nonsense", () => {
    const base = { DATABASE_URL: "postgres://x", AUTH_MODE: "dev" };
    expect(loadConfig(base)).toMatchObject({
      AUTH_AUDIENCE: "authenticated",
      RATE_LIMIT_PER_MINUTE: 120,
      RATE_LIMIT_PER_DAY: 5000,
      MAX_TOPICS_PER_USER: 500,
    });
    expect(() => loadConfig({ ...base, MAX_TOPICS_PER_USER: "9999" })).toThrow(/MAX_TOPICS_PER_USER/);
    expect(() => loadConfig({ ...base, RATE_LIMIT_PER_MINUTE: "0" })).toThrow(/RATE_LIMIT_PER_MINUTE/);
  });
});

describe("MCP", () => {
  it("initializes with PrepUp's instructions", async () => {
    const res = await mcp(USER, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(res.result.serverInfo.name).toBe("prepup");
    expect(res.result.instructions).toMatch(/Never call it before they confirm/);
    expect(res.result.instructions).toMatch(/Never reveal the user's saved explanation before they answer/);
  });

  it("lists the tools and prompts", async () => {
    const tools = await mcp(USER, "tools/list");
    expect(tools.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      "add_topic",
      "get_topic",
      "list_topics",
      "record_review",
      "whoami",
    ]);
    const prompts = await mcp(USER, "prompts/list");
    expect(prompts.result.prompts.map((p: { name: string }) => p.name).sort()).toEqual(["quick_capture", "test_me"]);
  });

  it("captures, tests and reports through the same core as REST", async () => {
    const add = await mcp(USER, "tools/call", { name: "add_topic", arguments: { term: "Speculative decoding" } });
    expect(add.result.content[0].text).toMatch(/Added "Speculative decoding"/);

    const tooHigh = await mcp(USER, "tools/call", {
      name: "record_review",
      arguments: { term: "speculative decoding", score: 5, feedback: "Great" },
    });
    expect(tooHigh.result.isError).toBe(true);
    expect(tooHigh.result.content[0].text).toMatch(/requires/);

    const ok = await mcp(USER, "tools/call", {
      name: "record_review",
      arguments: { term: "speculative decoding", score: 3, feedback: "Knows the draft-and-verify idea" },
    });
    expect(ok.result.content[0].text).toMatch(/now 3\/5/);

    const rest = (await (await app.request("/api/topics", as(USER))).json()) as Array<{ term: string; score: number }>;
    expect(rest).toMatchObject([{ term: "Speculative decoding", score: 3 }]);
  });

  it("runs a full test: reads the saved explanation after the answer, then saves score and draft together", async () => {
    await mcp(USER, "tools/call", { name: "add_topic", arguments: { term: "Vector databases" } });
    const topics = (await (await app.request("/api/topics", as(USER))).json()) as Array<{ id: string }>;
    await app.request(
      `/api/topics/${topics[0]!.id}`,
      as(USER, { method: "PATCH", body: JSON.stringify({ explanation: "Stores embeddings." }) }),
    );

    const read = await mcp(USER, "tools/call", { name: "get_topic", arguments: { term: "vector databases" } });
    const readText = read.result.content[0].text as string;
    expect(readText).toContain('"explanation": "Stores embeddings."');
    expect(readText).toContain('"explanationWrittenBy": "the user"');

    const saved = await mcp(USER, "tools/call", {
      name: "record_review",
      arguments: {
        term: "Vector databases",
        score: 3,
        feedback: "Knows ANN search, unsure about HNSW",
        explanation: "A vector database stores embeddings and finds the nearest ones to a query fast, using approximate search.",
      },
    });
    expect(saved.result.content[0].text).toMatch(/now 3\/5.*explanation was updated/s);

    const card = (await (await app.request(`/api/topics/${topics[0]!.id}`, as(USER))).json()) as {
      explanation: string;
      explanationBy: string;
    };
    expect(card).toMatchObject({ explanationBy: "claude", explanation: expect.stringContaining("nearest ones") });
  });

  it("rejects bad tool input instead of saving it", async () => {
    const res = await mcp(USER, "tools/call", { name: "record_review", arguments: { term: "x", score: 9, feedback: "?" } });
    expect(res.result?.isError ?? Boolean(res.error)).toBe(true);
  });
});

describe("MCP error handling", () => {
  it("hides unexpected errors from the client", async () => {
    const broken = new PrepUpService(new InMemoryRepository());
    broken.listTopics = async () => {
      throw new Error("select * from secrets where id = 42");
    };
    const app2 = createApp({ service: broken, auth: new DevAuthenticator(), publicUrl: PUBLIC_URL });
    const res = await app2.request(
      "/mcp",
      as(USER, {
        method: "POST",
        headers: { accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } }),
      }),
    );
    const text = JSON.stringify(await res.json());
    expect(text).toContain("unexpected error");
    expect(text).not.toContain("secrets");
  });
});

describe("deployment glue", () => {
  it("serves public config without auth and without secrets", async () => {
    const res = await app.request("/app-config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authMode: "supabase",
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: "sb_publishable_test",
      providers: [],
    });
  });

  it("restores the original path Vercel passes to the function", async () => {
    const { restorePath } = await import("../src/vercel-path.js");
    expect(restorePath("/server?__path=/api/topics&limit=5")).toBe("/api/topics?limit=5");
    expect(restorePath("/server?__path=/.well-known/oauth-protected-resource/mcp")).toBe(
      "/.well-known/oauth-protected-resource/mcp",
    );
    expect(restorePath("/mcp")).toBe("/mcp");
    expect(restorePath(undefined)).toBe("/");
  });
});

describe("social sign-in", () => {
  it("reads AUTH_PROVIDERS leniently but rejects unknown providers", () => {
    const base = { DATABASE_URL: "postgres://x", SUPABASE_URL };
    expect(loadConfig({ ...base, AUTH_PROVIDERS: " Google, github,,google " }).AUTH_PROVIDERS).toEqual(["google", "github"]);
    expect(loadConfig(base).AUTH_PROVIDERS).toEqual([]);
    expect(() => loadConfig({ ...base, AUTH_PROVIDERS: "facebook" })).toThrow(/AUTH_PROVIDERS/);
  });

  it("shows only the configured buttons, and keeps the consent page's CSP strict", async () => {
    const withSocial = createApp({
      service: new PrepUpService(new InMemoryRepository()),
      auth: new DevAuthenticator(),
      publicUrl: PUBLIC_URL,
      supabaseUrl: SUPABASE_URL,
      supabasePublishableKey: "sb_publishable_test",
      oauthProviders: ["google", "github"],
    });
    expect(await (await withSocial.request("/app-config")).json()).toMatchObject({ providers: ["google", "github"] });

    const html = await (await withSocial.request("/oauth/consent?authorization_id=abc")).text();
    expect(html).toContain('data-provider="google"');
    expect(html).toContain('data-provider="github"');
    expect(html).toContain("redirectTo: location.href");
    expect(html).not.toMatch(/ style="/);

    const plain = await (await app.request("/oauth/consent?authorization_id=abc")).text();
    expect(plain).not.toContain("data-provider=");
  });
});
