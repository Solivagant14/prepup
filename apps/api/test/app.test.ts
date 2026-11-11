import { FIXED_RULES, InMemoryRepository, PrepUpService } from "@prepup/core";
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
    expect(res.result.instructions).toContain("Act as a technical interviewer");
  });

  it("tests each user in their own style: at connect, in whoami and in the Test me prompt", async () => {
    const style = "Test me like a non-technical customer who asks why it matters.";
    const put = await app.request("/api/settings", as(USER, { method: "PUT", body: JSON.stringify({ testingStyle: style }) }));
    expect(await put.json()).toMatchObject({ testingStyle: style, preset: null });

    const init = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } };
    const mine = (await mcp(USER, "initialize", init)).result.instructions as string;
    expect(mine).toContain(style);
    expect(mine).not.toContain("Act as a technical interviewer");
    expect(mine.indexOf("Never call it before they confirm")).toBeLessThan(mine.indexOf(style));
    expect((await mcp(OTHER, "initialize", init)).result.instructions).not.toContain(style);

    // A chat that connected before the change still gets the new style from these two.
    const who = await mcp(USER, "tools/call", { name: "whoami", arguments: {} });
    expect(who.result.content[0].text).toContain(style);
    const prompt = await mcp(USER, "prompts/get", { name: "test_me", arguments: {} });
    expect(prompt.result.messages[0].content.text).toContain(style);
  });

  it("falls back to the default style if settings can't be read", async () => {
    const service = new PrepUpService(new InMemoryRepository());
    service.getSettings = async () => {
      throw new Error('relation "user_settings" does not exist');
    };
    const app2 = createApp({ service, auth: new DevAuthenticator(), publicUrl: PUBLIC_URL });
    const res = await app2.request(
      "/mcp",
      as(USER, {
        method: "POST",
        headers: { accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      }),
    );
    const text = JSON.stringify(await res.json());
    expect(text).toContain("Act as a technical interviewer");
    expect(text).not.toContain("user_settings");
  });

  it("shows the settings page exactly what the server registers", async () => {
    const page = (await (await app.request("/api/connector", as(USER))).json()) as {
      url: string;
      tools: Array<{ name: string; description: string }>;
      prompts: Array<{ name: string }>;
      fixedRules: Array<{ id: string; title: string; rule: string; why: string }>;
      presets: Array<{ id: string }>;
      settings: { preset: string };
    };
    expect(page.url).toBe(`${PUBLIC_URL}/mcp`);
    const live = (await mcp(USER, "tools/list")).result.tools as Array<{ name: string; description: string }>;
    const byName = (list: Array<{ name: string; description: string }>) =>
      list.map((t) => [t.name, t.description]).sort();
    expect(byName(page.tools)).toEqual(byName(live));
    const prompts = (await mcp(USER, "prompts/list")).result.prompts as Array<{ name: string }>;
    expect(page.prompts.map((p) => p.name).sort()).toEqual(prompts.map((p) => p.name).sort());
    expect(page.fixedRules.map((r) => r.id)).toEqual(FIXED_RULES.map((r) => r.id));
    expect(page.fixedRules).toHaveLength(9);
    // The page gets each rule twice: in everyday words, and exactly as Claude is told it.
    expect(page.fixedRules.map((r) => [r.title, r.rule])).toEqual(FIXED_RULES.map((r) => [r.title, r.rule]));
    expect(page.presets.map((p) => p.id)).toEqual(["interviewer", "tutor", "drill"]);
    expect(page.settings.preset).toBe("interviewer");
    expect((await app.request("/api/connector")).status).toBe(401);
  });

  it("rejects a bad testing style with a readable message", async () => {
    const res = await app.request("/api/settings", as(USER, { method: "PUT", body: JSON.stringify({ testingStyle: "" }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid", message: expect.stringContaining("how you want to be tested") });
  });

  it("lists the tools and prompts", async () => {
    const tools = await mcp(USER, "tools/list");
    expect(tools.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      "add_topic",
      "get_topic",
      "link_topics",
      "list_topics",
      "record_review",
      "search_topics",
      "unlink_topics",
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

describe("topic links over REST", () => {
  const add = async (user: string, term: string) => {
    const res = await app.request("/api/topics", as(user, { method: "POST", body: JSON.stringify({ term }) }));
    return ((await res.json()) as { id: string }).id;
  };
  const link = (user: string, id: string, buildsOnId: unknown) =>
    app.request(`/api/topics/${id}/links`, as(user, { method: "POST", body: JSON.stringify({ buildsOnId }) }));

  it("links, lists and unlinks, answering with the topic each time", async () => {
    const [rag, embeddings] = [await add(USER, "RAG"), await add(USER, "Embeddings")];

    const created = await link(USER, rag, embeddings);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ term: "RAG", buildsOn: [{ id: embeddings, term: "Embeddings" }], neededFor: [] });
    expect((await link(USER, rag, embeddings)).status).toBe(200);

    const list = (await (await app.request("/api/topics", as(USER))).json()) as Array<{ term: string; neededFor: unknown[] }>;
    expect(list.find((t) => t.term === "Embeddings")!.neededFor).toEqual([{ id: rag, term: "RAG" }]);

    const removed = await app.request(`/api/topics/${rag}/links/${embeddings}`, as(USER, { method: "DELETE" }));
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ term: "RAG", buildsOn: [] });
    // Removing it again is not an error.
    expect((await app.request(`/api/topics/${rag}/links/${embeddings}`, as(USER, { method: "DELETE" }))).status).toBe(200);
  });

  it("refuses loops and self-links with a message the web app can show", async () => {
    const [rag, embeddings] = [await add(USER, "RAG"), await add(USER, "Embeddings")];
    await link(USER, rag, embeddings);

    const loop = await link(USER, embeddings, rag);
    expect(loop.status).toBe(422);
    expect(await loop.json()).toEqual({
      error: "rule",
      message: `"Embeddings" can't build on "RAG": "RAG" already builds on "Embeddings", so this would make a loop.`,
    });
    const self = await link(USER, rag, rag);
    expect(self.status).toBe(422);
    expect(await self.json()).toMatchObject({ message: `"RAG" can't build on itself.` });
  });

  it("validates input and keeps other users out", async () => {
    const [rag, embeddings] = [await add(USER, "RAG"), await add(USER, "Embeddings")];
    const theirs = await add(OTHER, "Embeddings");

    const bad = await link(USER, rag, "not-a-uuid");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid", message: expect.stringContaining("Pick a topic to build on") });
    expect((await link(USER, rag, undefined)).status).toBe(400);
    const noJson = await app.request(`/api/topics/${rag}/links`, as(USER, { method: "POST", body: "{" }));
    expect(await noJson.json()).toMatchObject({ error: "invalid", message: "Request body must be JSON" });

    // Someone else's topic is simply not found, on either side of the link and for either verb.
    expect((await link(USER, rag, theirs)).status).toBe(404);
    expect((await link(OTHER, rag, theirs)).status).toBe(404);
    expect((await link(OTHER, rag, embeddings)).status).toBe(404);
    await link(USER, rag, embeddings);
    expect((await app.request(`/api/topics/${rag}/links/${embeddings}`, as(OTHER, { method: "DELETE" }))).status).toBe(404);
    expect((await app.request(`/api/topics/${rag}/links/nope`, as(USER, { method: "DELETE" }))).status).toBe(404);
    expect(((await (await app.request(`/api/topics/${rag}`, as(USER))).json()) as { buildsOn: unknown[] }).buildsOn).toHaveLength(1);
  });

  it("answers 401 without a sign-in", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const post = await app.request(`/api/topics/${id}/links`, { method: "POST", body: JSON.stringify({ buildsOnId: id }) });
    expect(post.status).toBe(401);
    expect((await app.request(`/api/topics/${id}/links/${id}`, { method: "DELETE" })).status).toBe(401);
  });

  it("drops a deleted topic's links from the cards around it", async () => {
    const [agents, rag, embeddings] = [await add(USER, "Agents"), await add(USER, "RAG"), await add(USER, "Embeddings")];
    await link(USER, agents, rag);
    await link(USER, rag, embeddings);
    await app.request(`/api/topics/${rag}`, as(USER, { method: "DELETE" }));
    const list = (await (await app.request("/api/topics", as(USER))).json()) as Array<{ buildsOn: unknown[]; neededFor: unknown[] }>;
    expect(list.map((t) => [t.buildsOn, t.neededFor])).toEqual([
      [[], []],
      [[], []],
    ]);
  });
});

describe("topic links over MCP", () => {
  const call = async (user: string, name: string, args: Record<string, unknown>) => {
    const res = await mcp(user, "tools/call", { name, arguments: args });
    return { text: (res.result?.content?.[0]?.text ?? "") as string, isError: Boolean(res.result?.isError ?? res.error) };
  };
  const data = (text: string) => JSON.parse(text.slice(text.indexOf("\n\n") + 2));

  it("returns similar topics on capture and links only when asked to", async () => {
    await call(USER, "add_topic", { term: "Embeddings" });
    await call(USER, "add_topic", { term: "Vector databases" });
    const added = await call(USER, "add_topic", { term: "Embedding models" });
    expect(added.text).toMatch(/Added "Embedding models".*ask the user before linking/s);
    expect(data(added.text)).toMatchObject({ term: "Embedding models", similarTopics: ["Embeddings"], buildsOn: [] });
    const plain = await call(USER, "add_topic", { term: "Evals" });
    expect(plain.text).not.toMatch(/linking/);
    expect(data(plain.text).similarTopics).toEqual([]);

    const linked = await call(USER, "link_topics", { term: "embedding models", buildsOnTerm: "embeddings" });
    expect(linked.isError).toBe(false);
    expect(linked.text).toMatch(/Linked: "Embedding models" now builds on "Embeddings"\./);
    expect(data(linked.text).buildsOn).toEqual(["Embeddings"]);
    expect((await call(USER, "link_topics", { term: "Embedding models", buildsOnTerm: "Embeddings" })).text).toMatch(
      /already builds on "Embeddings"; nothing changed/,
    );
  });

  it("shows links in get_topic and list_topics, and sorts prep by them", async () => {
    for (const term of ["RAG", "Embeddings", "Vector databases"]) await call(USER, "add_topic", { term });
    await call(USER, "link_topics", { term: "RAG", buildsOnTerm: "Embeddings" });
    await call(USER, "link_topics", { term: "RAG", buildsOnTerm: "Vector databases" });

    expect(data((await call(USER, "get_topic", { term: "RAG" })).text)).toMatchObject({
      buildsOn: ["Embeddings", "Vector databases"],
      neededFor: [],
    });
    expect(data((await call(USER, "get_topic", { term: "Embeddings" })).text)).toMatchObject({ buildsOn: [], neededFor: ["RAG"] });

    const topics = (await (await app.request("/api/topics", as(USER))).json()) as Array<{ id: string; term: string }>;
    const rag = topics.find((t) => t.term === "RAG")!;
    await app.request(`/api/topics/${rag.id}`, as(USER, { method: "PATCH", body: JSON.stringify({ importance: "high" }) }));
    const prep = data((await call(USER, "list_topics", { filter: "prep" })).text) as Array<{ term: string; buildsOn: string[] }>;
    expect(prep.map((t) => t.term)).toEqual(["Embeddings", "Vector databases", "RAG"]);
    expect(prep.at(-1)!.buildsOn).toEqual(["Embeddings", "Vector databases"]);
    const all = data((await call(USER, "list_topics", {})).text) as Array<{ term: string }>;
    expect(all[0]!.term).toBe("RAG");
  });

  it("refuses loops, unknown topics and self-links as readable tool errors", async () => {
    for (const term of ["Agents", "RAG", "Embeddings"]) await call(USER, "add_topic", { term });
    await call(USER, "link_topics", { term: "Agents", buildsOnTerm: "RAG" });
    await call(USER, "link_topics", { term: "RAG", buildsOnTerm: "Embeddings" });

    const loop = await call(USER, "link_topics", { term: "Embeddings", buildsOnTerm: "Agents" });
    expect(loop.isError).toBe(true);
    expect(loop.text).toBe(
      `"Embeddings" can't build on "Agents": "Agents" already builds on "Embeddings" (through another topic), so this would make a loop.`,
    );
    expect(await call(USER, "link_topics", { term: "RAG", buildsOnTerm: "rag" })).toEqual({
      isError: true,
      text: `"RAG" can't build on itself.`,
    });
    expect(await call(USER, "link_topics", { term: "RAG", buildsOnTerm: "Transformers" })).toEqual({
      isError: true,
      text: 'No topic called "Transformers" in PrepUp',
    });
    expect((await call(USER, "link_topics", { term: "RAG" })).isError).toBe(true);
    expect((await call(USER, "link_topics", { term: "", buildsOnTerm: "RAG" })).isError).toBe(true);
    // Another user's deck has none of these topics, so nothing of this one's can be linked or unlinked from there.
    expect((await call(OTHER, "unlink_topics", { term: "RAG", buildsOnTerm: "Embeddings" })).isError).toBe(true);
    expect(data((await call(USER, "get_topic", { term: "RAG" })).text).buildsOn).toEqual(["Embeddings"]);
  });

  it("unlinks, and says so when there was nothing to remove", async () => {
    for (const term of ["RAG", "Embeddings"]) await call(USER, "add_topic", { term });
    await call(USER, "link_topics", { term: "RAG", buildsOnTerm: "Embeddings" });
    const gone = await call(USER, "unlink_topics", { term: "RAG", buildsOnTerm: "Embeddings" });
    expect(gone.text).toMatch(/Unlinked: "RAG" no longer builds on "Embeddings"\./);
    expect(data(gone.text).buildsOn).toEqual([]);
    expect((await call(USER, "unlink_topics", { term: "RAG", buildsOnTerm: "Embeddings" })).text).toMatch(
      /wasn't linked to "Embeddings"; nothing changed/,
    );
    expect((await call(USER, "list_topics", {})).text).toContain('"term": "Embeddings"');
  });

  it("searches by text without revealing explanations", async () => {
    for (const term of ["Vector databases", "Vector search", "RAG"]) await call(USER, "add_topic", { term });
    await call(OTHER, "add_topic", { term: "Vector clocks" });
    const topics = (await (await app.request("/api/topics", as(USER))).json()) as Array<{ id: string; term: string }>;
    const search = topics.find((t) => t.term === "Vector search")!;
    await app.request(
      `/api/topics/${search.id}`,
      as(USER, { method: "PATCH", body: JSON.stringify({ explanation: "Find the nearest vectors." }) }),
    );

    const found = await call(USER, "search_topics", { query: "vector" });
    expect(found.text).toMatch(/^2 topic\(s\) match "vector"\./);
    expect(data(found.text).map((t: { term: string }) => t.term)).toEqual(["Vector databases", "Vector search"]);
    expect(found.text).not.toContain("nearest vectors");
    expect(data(found.text)[1]).toMatchObject({ hasExplanation: true, score: 1 });
    expect(data((await call(USER, "search_topics", { query: "vector", limit: 1 })).text)).toHaveLength(1);
    expect((await call(USER, "search_topics", { query: "kubernetes" })).text).toMatch(/^0 topic/);
    expect((await call(USER, "search_topics", { query: "" })).isError).toBe(true);
    expect((await call(USER, "search_topics", { query: "x", limit: 500 })).isError).toBe(true);
  });

  it("says in every link tool that the user must confirm first, and tells Claude so at connect", async () => {
    const tools = (await mcp(USER, "tools/list")).result.tools as Array<{
      name: string;
      description: string;
      inputSchema: { required?: string[] };
      annotations?: { readOnlyHint?: boolean };
    }>;
    const tool = (name: string) => tools.find((t) => t.name === name)!;
    expect(tool("link_topics").description).toMatch(/Only call after the user has said yes/);
    expect(tool("unlink_topics").description).toMatch(/Only call after the user has confirmed/);
    expect(tool("add_topic").description).toMatch(/links nothing itself/);
    expect(tool("link_topics").inputSchema.required).toEqual(["term", "buildsOnTerm"]);
    expect(tool("unlink_topics").inputSchema.required).toEqual(["term", "buildsOnTerm"]);
    expect(tool("search_topics").annotations?.readOnlyHint).toBe(true);

    const init = await mcp(USER, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.result.serverInfo.version).toBe("0.4.0");
    expect(init.result.instructions).toMatch(/call link_topics only after they say yes/);
    expect(init.result.instructions).toMatch(/builds on is weaker, test that prerequisite first/);
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
      supportUrl: null,
      sourceUrl: "https://github.com/Solivagant14/prepup",
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

describe("public costs page", () => {
  const base = { DATABASE_URL: "postgres://x", SUPABASE_URL };
  const hosted = (service = new PrepUpService(new InMemoryRepository())) =>
    createApp({
      service,
      auth: new DevAuthenticator(),
      publicUrl: PUBLIC_URL,
      rateLimit: { store: new InMemoryRateLimitStore(), perMinute: 120, perDay: 5000 },
      host: {
        monthlyCostUsd: 45,
        supportUrl: "https://buymeacoffee.com/someone",
        sourceUrl: "https://github.com/someone/fork",
        databaseLimitMb: 8000,
        maxTopics: 200,
      },
    });

  it("is open to anyone and reports a free copy by default", async () => {
    await app.request("/api/topics", as(USER, { method: "POST", body: JSON.stringify({ term: "RAG" }) }));
    await app.request("/api/topics", as(OTHER, { method: "POST", body: JSON.stringify({ term: "Embeddings" }) }));

    const res = await app.request("/host-status");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
    expect(await res.json()).toEqual({
      monthlyCostUsd: 0,
      supportUrl: null,
      sourceUrl: "https://github.com/Solivagant14/prepup",
      usage: { people: 2, topics: 2, databaseBytes: null },
      databaseLimitBytes: 500 * 1024 * 1024,
      limits: { topicsPerPerson: 500, requestsPerMinute: null, requestsPerDay: null },
    });
  });

  it("shows what the host configured: cost, support link, source and limits", async () => {
    const withHost = hosted();
    expect(await (await withHost.request("/host-status")).json()).toMatchObject({
      monthlyCostUsd: 45,
      supportUrl: "https://buymeacoffee.com/someone",
      sourceUrl: "https://github.com/someone/fork",
      databaseLimitBytes: 8000 * 1024 * 1024,
      limits: { topicsPerPerson: 200, requestsPerMinute: 120, requestsPerDay: 5000 },
    });
    expect(await (await withHost.request("/app-config")).json()).toMatchObject({
      supportUrl: "https://buymeacoffee.com/someone",
      sourceUrl: "https://github.com/someone/fork",
    });
  });

  it("gives totals only: no terms, ids or anything about one person", async () => {
    await app.request("/api/topics", as(USER, { method: "POST", body: JSON.stringify({ term: "Secret project" }) }));
    const text = await (await app.request("/host-status")).text();
    expect(text).not.toContain("Secret");
    expect(text).not.toContain(USER);
  });

  it("reads the totals once for many visits, and tries again after a failure", async () => {
    const service = new PrepUpService(new InMemoryRepository());
    let calls = 0;
    let fail = true;
    service.hostUsage = async () => {
      calls++;
      if (fail) throw new Error("database is waking up");
      return { people: 1, topics: 3, databaseBytes: 1024 };
    };
    const withHost = hosted(service);

    expect((await withHost.request("/host-status")).status).toBe(500);
    fail = false;
    const visits = await Promise.all(Array.from({ length: 20 }, () => withHost.request("/host-status")));
    expect(visits.every((v) => v.status === 200)).toBe(true);
    expect(await visits[0]!.json()).toMatchObject({ usage: { people: 1, topics: 3, databaseBytes: 1024 } });
    expect(calls).toBe(2);
  });

  it("isn't counted against anyone's request limit", async () => {
    const store = new InMemoryRateLimitStore();
    const limited = createApp({
      service: new PrepUpService(new InMemoryRepository()),
      auth: new DevAuthenticator(),
      publicUrl: PUBLIC_URL,
      rateLimit: { store, perMinute: 1, perDay: 5 },
    });
    for (let i = 0; i < 5; i++) expect((await limited.request("/host-status", as(USER))).status).toBe(200);
    expect((await limited.request("/api/topics", as(USER))).status).toBe(200);
  });

  it("reads the costs settings, and refuses a support link that isn't https", () => {
    expect(loadConfig(base)).toMatchObject({
      HOSTING_COST_PER_MONTH: 0,
      DATABASE_LIMIT_MB: 500,
      SOURCE_URL: "https://github.com/Solivagant14/prepup",
    });
    expect(
      loadConfig({ ...base, HOSTING_COST_PER_MONTH: "45", DATABASE_LIMIT_MB: "8000", SUPPORT_URL: " https://buymeacoffee.com/someone " }),
    ).toMatchObject({ HOSTING_COST_PER_MONTH: 45, DATABASE_LIMIT_MB: 8000, SUPPORT_URL: "https://buymeacoffee.com/someone" });
    // A blank variable, as hosts often save, means "not set".
    expect(loadConfig(base).SUPPORT_URL).toBeUndefined();
    expect(loadConfig({ ...base, SUPPORT_URL: "" }).SUPPORT_URL).toBeUndefined();
    expect(() => loadConfig({ ...base, SUPPORT_URL: "javascript:alert(1)" })).toThrow(/SUPPORT_URL/);
    expect(() => loadConfig({ ...base, SUPPORT_URL: "http://example.com" })).toThrow(/SUPPORT_URL/);
    expect(() => loadConfig({ ...base, HOSTING_COST_PER_MONTH: "-1" })).toThrow(/HOSTING_COST_PER_MONTH/);
  });
});
