# Turn on Google and GitHub sign-in

About 15 minutes. The buttons stay hidden until you finish step 4, so nothing breaks halfway. Never paste client secrets into a chat or commit them.

You'll need two URLs:

- **Supabase callback:** `https://<ref>.supabase.co/auth/v1/callback`
- **Your app:** `https://<project>.vercel.app`

## 1. Let Supabase send you back to PrepUp

Supabase › Authentication › URL Configuration › **Redirect URLs** › add `https://<project>.vercel.app/**`.

This allows both the web app and the Claude consent page (`/oauth/consent?...`) as places to return to after sign-in.

## 2. Google

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project named "PrepUp".
2. **Google Auth Platform › Branding** (or *OAuth consent screen*): set the app name to PrepUp and add your email. Audience: **External**. While it's in *Testing*, add yourself as a test user, or publish it.
3. **Clients › Create client › Web application**:
   - Authorized JavaScript origins: `https://<project>.vercel.app`
   - Authorized redirect URIs: `https://<ref>.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret**.
5. Supabase › Authentication › Sign In / Providers › **Google**: enable it, paste both values, and save.

## 3. GitHub

1. Go to GitHub › Settings › Developer settings › **OAuth Apps › New OAuth App**:
   - Homepage URL: `https://<project>.vercel.app`
   - Authorization callback URL: `https://<ref>.supabase.co/auth/v1/callback`
2. Register it, then **Generate a new client secret**.
3. Supabase › Authentication › Sign In / Providers › **GitHub**: enable it, paste the Client ID and secret, and save.

## 4. Show the buttons

Vercel › Settings › Environment Variables › add `AUTH_PROVIDERS` = `google,github`, then redeploy.

Use just `google` if you only set that one up.

## 5. Check you land in your own deck

1. Sign out of the web app, then **Continue with Google** using the **same email** as your current PrepUp account.
2. Supabase links sign-in methods that share a verified email to one user, so you should see your existing topics.
3. **If the deck is empty, stop:** a separate account was created. Tell me before adding anything, and we'll merge it.

GitHub links the same way only if your GitHub account's primary email is that same address.

## 6. Optional: Claude connector

Your existing connection keeps working. If you reconnect it later, the "Connect to PrepUp" page will offer Google and GitHub too.

## 7. Optional: go password-free

Once Google works for both the web app and Claude:

- Supabase › Sign In / Providers › **Email**: turn it off. Passwords can then no longer be used.
- Keep **Allow new users to sign up** off if PrepUp is only for you. This also stops strangers creating accounts with *their* Google login.
