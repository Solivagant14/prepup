# Deploy PrepUp on Vercel (free, Hobby plan)

One Vercel project serves everything: the web app, the REST API, the MCP server for Claude and the OAuth consent page. About 20 minutes. Never paste keys into a chat or commit them.

Your Supabase project is already set up from M0 (signing keys, OAuth server, dynamic client registration), and the database tables already exist.

## 1. Create the Vercel project

1. Sign up at vercel.com with GitHub (Hobby, free).
2. **Add New › Project**, import `Solivagant14/prepup`.
3. Framework preset: **Other**. Leave the build and install commands alone; `vercel.json` sets them. Root directory: the repo root.
4. Before deploying, open **Environment Variables** and add (for Production and Preview):

| Name | Value |
|---|---|
| `DATABASE_URL` | Supabase › Connect › **Transaction pooler** string (port **6543**), with your database password filled in |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Your publishable key |
| `PUBLIC_URL` | `https://<project>.vercel.app` (your project's production URL, no trailing slash) |

Use the **transaction** pooler here, not the session pooler you used on Fly: serverless functions open many short connections, which is what it's built for.

5. **Deploy.**

If you didn't know the final URL before deploying, set `PUBLIC_URL` afterwards and redeploy (Deployments › … › Redeploy).

## 2. Put the function near your database

Settings › Functions › **Function Region**: pick the region closest to your Supabase project (Supabase shows its region under Project Settings › General; e.g. Singapore → `sin1`, Mumbai → `bom1`). Each request makes a few database calls, so a far-away region makes every click slow.

Redeploy after changing it.

## 3. Point Supabase at the new URL

Authentication › URL Configuration › **Site URL** = `https://<project>.vercel.app`. The consent page now lives at that URL + `/oauth/consent`.

## 4. Check it

```bash
curl https://<project>.vercel.app/health
# {"ok":true}
curl https://<project>.vercel.app/.well-known/oauth-protected-resource/mcp
# "resource" should be https://<project>.vercel.app/mcp
```

Open `https://<project>.vercel.app` and sign in with the same email you used for the Claude connector. You should see the topics you added through Claude.

## 5. Reconnect Claude

1. Claude › Settings › Connectors: remove the old PrepUp connector (the Fly URL).
2. Add a custom connector with URL `https://<project>.vercel.app/mcp`, then **Connect** and **Allow**.
3. New chat: *"Use PrepUp's whoami tool."* The topic count should match the web app.

## 6. Only then: shut down Fly

Once step 5 works:

```bash
fly apps destroy <your-fly-app>
```

This permanently deletes the Fly app and stops its billing. Your data is in Supabase, so nothing is lost.

## Later: database migrations

Vercel doesn't run migrations. When a PR changes the schema, run this once from your Mac, using the **session** pooler string (port 5432):

```bash
DATABASE_URL='postgres://...session-pooler...:5432/postgres' pnpm db:migrate
```

## If something's off

| Symptom | Probable cause |
|---|---|
| Site says "isn't configured yet" | `SUPABASE_URL` or `SUPABASE_PUBLISHABLE_KEY` missing; redeploy after adding |
| Claude can't connect | `PUBLIC_URL` doesn't match the real URL, or Supabase's Site URL still points at Fly |
| Every click takes over a second | Function region is far from Supabase (step 2) |
| Errors mentioning "prepared statement" | `DATABASE_URL` is the session pooler; use the transaction pooler (6543) |
| First load after a while is slow | A cold start (~1 s); normal on the free plan |
