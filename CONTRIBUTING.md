# Contributing to PrepUp

Thanks for wanting to help. Bug reports, ideas, documentation fixes and code are all welcome.

- **Found a bug?** [Open an issue](https://github.com/Solivagant14/prepup/issues/new/choose).
- **Have an idea or a question?** [Start a discussion](https://github.com/Solivagant14/prepup/discussions). For anything bigger than a small fix, talk it through there before writing code, so nobody builds something that can't be merged.
- **Found a security problem?** Don't open an issue. See [SECURITY.md](SECURITY.md).

## Set up

You need Node 22 or newer. pnpm comes with it through `corepack`.

```bash
git clone https://github.com/Solivagant14/prepup.git
cd prepup
corepack enable && pnpm install
pnpm test
```

The tests use an in-process Postgres (PGlite), so there is no database or Docker to set up.

## Run it locally

To see the app in a browser you need a Postgres database. Any will do; with Docker:

```bash
cp .env.example .env    # AUTH_MODE=dev: no sign-in, one local user
docker run -d --name prepup-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=prepup -p 5432:5432 postgres:17
pnpm db:migrate
pnpm dev                # API on http://localhost:8080
pnpm dev:web            # web app on http://localhost:5173, in a second terminal
```

Open http://localhost:5173. In dev mode there is no sign-in screen; you land on the deck as a local user.

To call the API directly, send any UUID as the user:

```bash
curl -X POST localhost:8080/api/topics \
  -H 'x-dev-user-id: 11111111-1111-4111-8111-111111111111' \
  -H 'content-type: application/json' -d '{"term":"RAG"}'
```

Working on sign-in or the connector's OAuth flow needs a real Supabase project: follow [docs/self-hosting.md](docs/self-hosting.md) and set `AUTH_MODE=supabase`.

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | All tests, once. `pnpm test:watch` reruns on change |
| `pnpm typecheck` | TypeScript across every package |
| `pnpm dev` / `pnpm dev:web` | The API and the web app, with reload |
| `pnpm build` | Bundles the API |
| `pnpm build:vercel` | Builds exactly what Vercel deploys, into `.vercel/output` |
| `pnpm db:generate` | Writes a SQL migration after you change `packages/db/src/schema.ts` |
| `pnpm db:migrate` | Applies migrations to `DATABASE_URL` |

## Before you write code

Read [docs/architecture.md](docs/architecture.md). It is short, and it lists the rules a change must keep and where each kind of change belongs. The ones people trip on most:

- Business rules live only in `packages/core`. The REST and MCP adapters stay thin.
- Input shapes are defined once, in `packages/contracts`.
- Scores are computed from `review_events`. Never store a score on a topic.
- Nothing is saved or linked by an assistant without the user's yes.
- Product copy says "your assistant", not one app's name, and isn't written for one role or field.

## Send a change

1. Fork the repo and create a branch from `main`.
2. Make the change. Add or update a test with every rule change.
3. If you changed the database schema, run `pnpm db:generate` and commit the generated SQL.
4. Run the checks CI runs:

   ```bash
   pnpm typecheck && pnpm test && pnpm build && pnpm build:vercel
   ```

5. Open a pull request against `main` and fill in the template. Keep it to one topic; small pull requests are reviewed faster.

Never commit secrets. `.env` is gitignored; keep keys out of code, issues and screenshots.

## Using an AI coding assistant

That's fine. [CLAUDE.md](CLAUDE.md) holds the project's rules in a form coding assistants read. You are still responsible for the change: read it, test it, and be ready to explain it in review.

## Conduct

Be kind and assume good intent. The full version is in the [Code of Conduct](CODE_OF_CONDUCT.md).

By contributing you agree that your work is released under the [MIT license](LICENSE).
