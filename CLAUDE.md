# PrepUp — notes for Claude Code

## Commands

- `pnpm install` · `pnpm test` · `pnpm typecheck` · `pnpm build`
- `pnpm dev` runs the API with `.env` (copy `.env.example`); `pnpm dev:web` runs the web app
- `pnpm build:vercel` builds what Vercel deploys (`.vercel/output`)
- `pnpm db:generate` after changing `packages/db/src/schema.ts`; commit the generated SQL

## Architecture rules

- Business rules live only in `packages/core`. Adapters (`apps/api` REST and MCP, `packages/db`) stay thin and call `PrepUpService`.
- Input shapes are defined once in `packages/contracts` and reused by REST and MCP.
- The core depends on the `PrepUpRepository` port, never on Drizzle or Postgres.
- Every query is scoped by `workspace_id`, and by `user_id` for personal data. The one exception is `hostUsage` (the public costs page): it returns host-wide counts only, never a row.
- Scores are computed from `review_events`; never store a score on the topic.
- Only `record_review` (a test through the connector) resets the fade clock. Manual edits don't.
- Links (`topic_links`, "builds on") never change a score or the fade clock. The core rejects loops; the graph functions are pure and live in `packages/core/src/links.ts`, which the web app imports as `@prepup/core/links`.
- Nothing is saved, linked or deleted by an assistant without the user's yes in chat; say so in the tool description.
- PrepUp has no LLM API. AI happens in the user's own AI app, through MCP. PrepUp works with any MCP client: product copy says "your assistant" and names an app only in that app's connect steps (`apps/web/src/components/guide/pages.tsx`). Internal values such as the `claude_test` event kind keep their names.
- PrepUp is for any learner. Keep product copy and MCP instructions free of one role or field.
- The guide (`/guide`, public) lists its pages in `apps/web/src/lib/guide.ts` and reads the connector's address, tools and rules from the public `/connector` route, never from copies. A rule the guide should lead with gets a `promise` in `testing.ts`.
- How a test runs is defined in `packages/core/src/testing.ts`: fixed rules (ours) and the testing style (the user's). MCP tools are described once, in `TOOLS` in `apps/api/src/mcp.ts`.

## Working rules

- Never commit secrets. `.env` is gitignored; production uses Vercel environment variables.
- Never push to `main`; work on a branch and open a PR.
- Add or update tests with every rule change; `pnpm test` must pass.
- Don't deploy or run migrations against Supabase unless asked.
