# PrepUp — notes for Claude Code

## Commands

- `pnpm install` · `pnpm test` · `pnpm typecheck` · `pnpm build`
- `pnpm dev` runs the API with `.env` (copy `.env.example`)
- `pnpm db:generate` after changing `packages/db/src/schema.ts`; commit the generated SQL

## Architecture rules

- Business rules live only in `packages/core`. Adapters (`apps/api` REST and MCP, `packages/db`) stay thin and call `PrepUpService`.
- Input shapes are defined once in `packages/contracts` and reused by REST and MCP.
- The core depends on the `PrepUpRepository` port, never on Drizzle or Postgres.
- Every query is scoped by `workspace_id`, and by `user_id` for personal data.
- Scores are computed from `review_events`; never store a score on the topic.
- Only `record_review` (a Claude test) resets the fade clock. Manual edits don't.
- PrepUp has no LLM API. AI happens in the user's Claude, through MCP.

## Working rules

- Never commit secrets. `.env` is gitignored; production uses `fly secrets`.
- Never push to `main`; work on a branch and open a PR.
- Add or update tests with every rule change; `pnpm test` must pass.
- Don't deploy or run migrations against Supabase unless asked.
