# M0 checklist: connect Claude to PrepUp

These are the steps only you can do, because they need your logins. About 30 minutes. Never paste keys into a chat or commit them.

The goal: in the Claude app, "Use PrepUp's whoami tool" answers "Connected to PrepUp".

## 1. Supabase (dashboard)

Supabase's menu names change now and then; look for the closest match.

1. **Asymmetric signing keys.** Project Settings › JWT Keys: switch to (or rotate in) an **ECC (P-256)** signing key. PrepUp checks tokens against the project's public keys, which only works with asymmetric keys.
2. **Email sign-in.** Authentication › Sign In / Providers: keep Email on. For the spike, you can turn off "Confirm email" so you can sign in straight away.
3. **OAuth server.** Authentication › OAuth Server: enable it, set the **authorization path** to `/oauth/consent`, and turn on **dynamic client registration** (Claude registers itself as a client).
4. **Site URL.** Authentication › URL Configuration: set Site URL to your Fly URL from step 2 below, e.g. `https://prepup-api.fly.dev`. The consent page lives at Site URL + `/oauth/consent`.
5. **Copy three values** for step 2:
   - Project URL (`https://<ref>.supabase.co`)
   - Publishable key (safe to expose; used by the consent page)
   - Database connection string: Connect › **Session pooler** (port 5432), with your database password filled in

## 2. Fly.io (terminal on your Mac)

```bash
brew install flyctl          # if needed
fly auth login
cd prepup
fly launch --no-deploy --copy-config   # keep region bom; rename the app if prepup-api is taken

fly secrets set \
  DATABASE_URL='postgres://...session-pooler...:5432/postgres' \
  SUPABASE_URL='https://<ref>.supabase.co' \
  SUPABASE_PUBLISHABLE_KEY='sb_publishable_...' \
  PUBLIC_URL='https://<your-app>.fly.dev'

fly deploy                   # runs the migrations first, then starts the API
```

Check it:

```bash
curl https://<your-app>.fly.dev/health
# {"ok":true}
curl https://<your-app>.fly.dev/.well-known/oauth-protected-resource/mcp
# authorization_servers should show https://<ref>.supabase.co/auth/v1
```

If you renamed the app, update the Site URL in Supabase to match.

## 3. Claude app

1. Settings › Connectors › **Add custom connector**.
2. Name: `PrepUp`. URL: `https://<your-app>.fly.dev/mcp`. Add, then **Connect**.
3. A browser page "Connect to PrepUp" opens. Create an account (or sign in), then **Allow**.
4. In a new chat: *"Use PrepUp's whoami tool."* Expect: "Connected to PrepUp. 0 topic(s) in your deck."
5. Then: *"Add RAG and vector databases to PrepUp."* and *"Test me on RAG."*

## 4. Tell me what happened

Paste any error text (not keys) back into our chat. The likely failure points, in order:

| Symptom | Probable cause |
|---|---|
| Claude says it can't connect, no browser page opens | Dynamic client registration is off, or the metadata URL is wrong |
| Consent page says "not configured" | `SUPABASE_URL` or `SUPABASE_PUBLISHABLE_KEY` secret missing |
| Consent page loads but Allow fails | OAuth server disabled, or Site URL doesn't match the Fly URL |
| Connected, but every tool call says "Sign in" | Signing key is still HS256 (step 1.1) |

If Supabase's OAuth server can't do what Claude needs, the fallback is an auth library with built-in MCP OAuth support; that's a contained change in `apps/api/src/auth.ts`.
