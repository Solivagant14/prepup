# Run your own PrepUp

PrepUp is one Vercel project and one Supabase project, both on free plans. About 45 minutes the first time. Never commit keys or paste them into a chat.

| Piece | What it does | Free plan limit that matters |
|---|---|---|
| Supabase | Postgres, sign-in, and the OAuth server Claude signs in through | 500 MB database; pauses after 7 idle days; no backups |
| Vercel | The web app plus one function for the API and MCP server | 4 hours of CPU a month (roughly 800 ten-topic test sessions a day) |

Use a Supabase project that serves **only** PrepUp. PrepUp accepts any signed-in user of that project.

## 1. Supabase

Dashboard labels move around; the settings below are what matters.

1. Create a project in the region closest to you. Save the database password.
2. **Signing keys:** under the JWT settings, switch to asymmetric signing keys (ES256). PrepUp verifies tokens against the project's public keys and never holds a secret.
3. **OAuth server:** under Authentication, turn on the OAuth 2.1 server and **dynamic client registration** (how Claude registers itself). Set the authorization (consent) path to `/oauth/consent`.
4. **Sign-in:** enable Google by following [social-login.md](social-login.md). For a shared instance, leave **Allow new users to sign up** on.
5. Note three values: the project URL (`https://<ref>.supabase.co`), the publishable key, and the **transaction pooler** connection string (port 6543).

## 2. Create the tables

From a clone of this repo, using the **session pooler** string (port 5432):

```bash
corepack enable && pnpm install
DATABASE_URL='postgres://...session-pooler...:5432/postgres' pnpm db:migrate
```

Run this again whenever a release adds a migration.

## 3. Vercel

Follow steps 1 to 4 of [deploy-vercel.md](deploy-vercel.md): import your fork, add the four environment variables, deploy, set the function region, and point Supabase's Site URL at your Vercel URL. To show the Google button, also set `AUTH_PROVIDERS=google`.

Optional limits, with their defaults:

| Variable | Default | Meaning |
|---|---|---|
| `RATE_LIMIT_PER_MINUTE` | 120 | Requests per user per minute |
| `RATE_LIMIT_PER_DAY` | 5000 | Requests per user per day |
| `MAX_TOPICS_PER_USER` | 500 | Topics per deck (500 is the maximum) |
| `AUTH_AUDIENCE` | `authenticated` | The `aud` claim a token must carry |

The public costs page (`/costs`) works with no settings. To make it describe your copy:

| Variable | Default | Meaning |
|---|---|---|
| `HOSTING_COST_PER_MONTH` | 0 | What the copy costs you a month, in US dollars |
| `DATABASE_LIMIT_MB` | 500 | The database size your plan allows (Supabase Free is 500, Pro is 8000) |
| `SUPPORT_URL` | empty | An `https://` link for people who want to chip in (Buy Me a Coffee, GitHub Sponsors). Empty hides it |
| `SOURCE_URL` | this repo | Shown as "Source"; point it at your fork |

The page shows totals for the whole copy: how many people and topics, and the database's size. It never shows anyone's topics.

## 4. Connect Claude

Open your site, sign in, and go to **Claude setup**. It shows your connector URL and the steps.

## 5. Before you invite anyone

- Turn on nightly backups: [backups.md](backups.md).
- Tell people what you store: their topics, scores, explanations, test answers and sign-in email. They can remove all but the email with **Erase all my data** on the Account screen; you can delete the sign-in record in Supabase under Authentication › Users.

## Costs when you outgrow free

Vercel Pro ($20/month) and Supabase Pro ($25/month). Supabase is usually first: it adds backups and stops the project pausing.
