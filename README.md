# PrepUp

A focused tracker for the AI buzzwords you're preparing for interviews. Capture a term the moment you hear it, let Claude test you on it, and watch your deck darken as you master it.

PrepUp has **no AI of its own**. All testing runs in your own Claude app through an MCP connector; PrepUp is the system of record.

## How it fits together

```mermaid
flowchart TB
  web["Web app (M2)<br/>card deck, progress"] -->|HTTPS + JSON| rest
  claude["Claude app<br/>your own plan"] -->|MCP tool calls| mcp
  subgraph api["API service · one container"]
    rest["REST adapter<br/>/api/*"]
    mcp["MCP adapter<br/>/mcp"]
    core["Core domain<br/>the only place rules live"]
    rest --> core
    mcp --> core
  end
  core -->|Drizzle| db[("Supabase Postgres")]
  claude -. OAuth sign-in .-> sauth["Supabase Auth<br/>OAuth 2.1 server"]
```

**Ports and adapters** (hexagonal architecture): the core knows nothing about HTTP, MCP or Postgres. Both doors call the same `PrepUpService`, so a topic added from your phone through Claude follows the same rules as one added in the browser.

| Package | What it holds |
|---|---|
| `packages/contracts` | Zod schemas shared by REST and MCP: one definition of "a topic" |
| `packages/core` | Scoring and fade rules (pure functions), `PrepUpService`, the repository port |
| `packages/db` | Drizzle schema, SQL migrations, the Postgres adapter |
| `apps/api` | Hono HTTP server: REST routes, the MCP server at `/mcp`, token checks, OAuth consent page |
| `skills/prepup-coach` | An optional Claude skill that makes testing interview-style |

## The rules

- **One score, 1–5.** 1–4 is how well you understand a topic and answer questions; 5 means you can explain it clearly.
- **Fading.** A score drops one step every 14 days without a Claude test. Only a Claude test (`record_review`) resets that clock.
- **Manual edits** change the score you see, but the clock keeps running, and the edit is labelled in history.
- **A 5 must be earned.** `record_review` rejects a 5 unless `explained: true`, and the database enforces it too.
- **Duplicates merge.** "LangChain", "lang chain" and "Lang-Chain" are one card.

## Design decisions

| Decision | Why | Trade-off |
|---|---|---|
| Ports and adapters | Rules live in one tested place; interfaces are swappable | A little more structure than plain CRUD |
| Append-only `review_events` | Full history; the fade formula can change without migrating data | Scores are computed on read |
| Fade computed at read time | No cron job or worker to run | Recomputed per request; trivial at this size |
| `workspace_id` on every row | Collaboration later is UI work, not a migration | Slightly more setup now |
| Stateless MCP over Streamable HTTP | A fresh MCP server per request; nothing lost when a machine sleeps | No server-pushed notifications (not needed) |
| PrepUp as OAuth resource server | Never handles passwords; Supabase issues tokens, we verify them via JWKS | Depends on Supabase's OAuth server (beta) |
| RLS on, no policies | Supabase's public Data API can read nothing; the server enforces scoping in every query | Policies are needed if a client ever queries Supabase directly |

## Running it locally

Requires Node 22+ and pnpm (`corepack enable`).

```bash
pnpm install
pnpm test          # unit + database tests (uses PGlite, no Docker needed)
pnpm typecheck
```

To run the server against a local Postgres:

```bash
cp .env.example .env               # AUTH_MODE=dev for local use
docker run -d --name prepup-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=prepup -p 5432:5432 postgres:17
pnpm db:migrate
pnpm dev

# Dev auth trusts this header. Any UUID works as a user id.
curl -X POST localhost:8080/api/topics \
  -H 'x-dev-user-id: 11111111-1111-4111-8111-111111111111' \
  -H 'content-type: application/json' -d '{"term":"RAG"}'
```

Deploying and connecting Claude: see [docs/m0-checklist.md](docs/m0-checklist.md).

## Roadmap

- **M0** Auth spike: Claude connects to `/mcp` behind a real Supabase login
- **M1** Core, database and tests
- **M2** Web app: the card deck
- **M3** MCP polish and the PrepUp Coach skill, tested end to end from iPhone
- **M4** Ship: CI deploy, demo video
