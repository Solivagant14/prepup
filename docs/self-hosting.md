# Run your own PrepUp

PrepUp is one Vercel project and one Supabase project, both on free plans. Allow about an hour the first time. Never commit keys or paste them into a chat.

| Piece | What it does | Free plan limit that matters |
|---|---|---|
| Supabase | Postgres, sign-in, and the OAuth server AI apps sign in through | 500 MB database; pauses after 7 idle days; no backups |
| Vercel | The web app, plus one function for the API and the MCP server | 4 hours of CPU a month |

Dashboard labels move around; the settings below are what matter.

## 1. Create the Supabase project

Use a project that serves **only** PrepUp. PrepUp accepts any signed-in user of that project.

1. Create a project in the region closest to you. Save the database password.
2. **Signing keys:** under the JWT settings, switch to asymmetric signing keys (ES256). PrepUp verifies tokens against the project's public keys and never holds a secret.
3. **OAuth server:** under Authentication, turn on the OAuth 2.1 server and **dynamic client registration** (how an AI app registers itself). Set the authorization (consent) path to `/oauth/consent`.
4. Note four values: the project URL (`https://<ref>.supabase.co`), the publishable key, and two connection strings from **Connect**: the **session pooler** (port 5432) and the **transaction pooler** (port 6543).

## 2. Create the tables

Fork this repo, clone your fork, and run the migrations with the **session pooler** string:

```bash
corepack enable && pnpm install
DATABASE_URL='postgres://...session-pooler...:5432/postgres' pnpm db:migrate
```

Vercel doesn't run migrations. Run this again whenever you pull a release that adds one (the [changelog](../CHANGELOG.md) says which do).

## 3. Deploy on Vercel

1. Sign up at vercel.com with GitHub (Hobby is free).
2. **Add New › Project** and import your fork.
3. Framework preset: **Other**. Leave the build and install commands alone; `vercel.json` sets them.
4. Add these environment variables, for Production and Preview:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | The **transaction pooler** string (port 6543), with your database password filled in |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_PUBLISHABLE_KEY` | Your publishable key |
   | `PUBLIC_URL` | `https://<project>.vercel.app`, no trailing slash |

5. **Deploy.** If you didn't know the final URL beforehand, set `PUBLIC_URL` afterwards and redeploy.
6. **Settings › Functions › Function Region:** pick the region closest to your Supabase project, then redeploy. Each request makes a few database calls, so a far-away region makes every click slow.

Every other setting is optional: see [configuration.md](configuration.md).

## 4. Set up sign-in

Follow [sign-in.md](sign-in.md). It points Supabase at your Vercel URL, turns on email and password, and optionally Google and GitHub. Don't skip its email-delivery step, or nobody outside your Supabase team can confirm an account.

## 5. Check it

```bash
curl https://<project>.vercel.app/health
# {"ok":true}
curl https://<project>.vercel.app/.well-known/oauth-protected-resource/mcp
# "resource" should be https://<project>.vercel.app/mcp
```

Open the site, create an account and add a topic.

## 6. Connect an AI app

Open **Guide › Connect your assistant** (`/guide/connect`) on your site. It shows your copy's connector address and the steps for each app. The guide needs no sign-in, so you can send people the link.

## 7. Before you invite anyone

- Turn on nightly backups: [backups.md](backups.md).
- Tell people what you store: their topics, scores, explanations, test answers and sign-in email. They can remove all but the email with **Erase all my data** in Settings; you can delete the sign-in record in Supabase under Authentication › Users.
- Optionally describe your copy on its public costs page: see [configuration.md](configuration.md#the-costs-page).

## Use your own domain

Optional. Replace `example.com` with your domain.

1. **Vercel:** under Settings › Domains, add `example.com` and create the DNS records it shows. Add `www.example.com` too, set to redirect to `example.com`.
2. **Vercel:** set `PUBLIC_URL` to `https://example.com` and redeploy.
3. **Supabase:** under URL Configuration, set **Site URL** to `https://example.com` and add `https://example.com/**` to **Redirect URLs**. The Site URL also decides where the connector's consent page opens, so connecting an AI app fails until it matches. Keep the old address in Redirect URLs until everyone has moved.
4. **Google:** add `https://example.com` to the client's Authorized JavaScript origins. The redirect URI stays the Supabase callback.
5. **GitHub:** change the OAuth app's Homepage URL. The callback stays the same.
6. **Reconnect assistants:** a connector added with the old address stops working once `PUBLIC_URL` changes, because the server now names the new one. Remove it and add `https://example.com/mcp`.
7. Run the checks in [step 5](#5-check-it) against the new address.

## If something's off

| Symptom | Probable cause |
|---|---|
| Site says "isn't configured yet" | `SUPABASE_URL` or `SUPABASE_PUBLISHABLE_KEY` is missing; redeploy after adding |
| An AI app can't connect | `PUBLIC_URL` doesn't match the real URL, or Supabase's Site URL points somewhere else |
| Every click takes over a second | The function region is far from Supabase (step 3.6) |
| Errors mentioning "prepared statement" | `DATABASE_URL` is the session pooler; Vercel needs the transaction pooler (6543) |
| Everyone gets 401 | Tokens don't carry `aud: authenticated`; set `AUTH_AUDIENCE` to the value your Supabase project uses |
| "Too many requests" in normal use | Raise `RATE_LIMIT_PER_MINUTE` |
| Saving a testing style fails, or links don't appear | A migration hasn't run (step 2) |
| First load after a while is slow | A cold start (about 1 s); normal on the free plan |

## When you outgrow free

Vercel Pro is $20 a month and Supabase Pro is $25 a month. Supabase is usually first: it adds backups and stops the project pausing.
