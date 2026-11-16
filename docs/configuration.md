# Configuration

Every setting is an environment variable. Locally they come from `.env` (copy [`.env.example`](../.env.example)); in production, set them in Vercel under Settings › Environment Variables and redeploy.

Invalid values stop the server at start-up with a message naming the variable.

## Required in production

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. On Vercel use Supabase's **transaction pooler** (port 6543) |
| `SUPABASE_URL` | Your Supabase project URL, `https://<ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | The project's publishable key. Safe in the browser |
| `PUBLIC_URL` | The address people open, `https://<project>.vercel.app`, no trailing slash. The connector address is built from it |

## Sign-in

| Variable | Default | Meaning |
|---|---|---|
| `AUTH_MODE` | `supabase` | `supabase` checks real tokens. `dev` trusts an `x-dev-user-id` header: local use only, refused when `NODE_ENV=production` |
| `AUTH_PROVIDERS` | empty | Social buttons to show: `google`, `github` or `google,github`. Each must also be enabled in Supabase ([sign-in.md](sign-in.md)). Empty means email only |
| `AUTH_AUDIENCE` | `authenticated` | The `aud` claim a token must carry |

## Limits

These protect a shared copy from one heavy account.

| Variable | Default | Meaning |
|---|---|---|
| `RATE_LIMIT_PER_MINUTE` | 120 | Requests per user per minute |
| `RATE_LIMIT_PER_DAY` | 5000 | Requests per user per day |
| `MAX_TOPICS_PER_USER` | 500 | Topics per deck. 500 is the maximum |

## The costs page

`/costs` is public and works with no settings. These make it describe your copy. It shows totals only, never anyone's topics.

| Variable | Default | Meaning |
|---|---|---|
| `HOSTING_COST_PER_MONTH` | 0 | What the copy costs you a month, in US dollars |
| `DATABASE_LIMIT_MB` | 500 | The database size your plan allows (Supabase Free is 500) |
| `SUPPORT_URL` | empty | An `https://` link for people who want to chip in. Empty hides it |
| `SOURCE_URL` | this repo | Shown as "Source". Point it at your fork |

## Local development

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | The port `pnpm dev` listens on |
| `DB_POOL_MAX` | 5 | Database connections the server may hold |
