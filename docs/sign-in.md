# Set up sign-in: email, Google and GitHub

About 30 minutes. PrepUp's sign-in screen offers email and password (sign in, create account, reset password) and, once you turn them on, Google and GitHub. All of it is configured in Supabase; the only PrepUp setting is `AUTH_PROVIDERS`. Never paste client secrets into a chat or commit them.

You'll need two addresses:

- **Your app:** `https://<project>.vercel.app`
- **Supabase callback:** `https://<ref>.supabase.co/auth/v1/callback`

Dashboard labels move around; the settings are what matter.

## 1. Tell Supabase where your app lives

Supabase › Authentication › **URL Configuration**:

- **Site URL:** `https://<project>.vercel.app`
- **Redirect URLs:** add `https://<project>.vercel.app/**`

Confirmation and reset emails send people back to the Site URL, and the `/**` entry lets Google, GitHub and the connector's consent page (`/oauth/consent`) return too.

## 2. Email and password

Supabase › Authentication › Sign In / Providers › **Email**:

- **Enable** the Email provider.
- **Confirm email:** on. New accounts must open a link before they can sign in.
- **Minimum password length:** 8, to match what the sign-up form asks for.
- Under Authentication settings, keep **Allow new users to sign up** on.

## 3. Email delivery (do not skip this)

Supabase's built-in email service sends only to addresses in your Supabase team, at 2 emails an hour, and is not meant for production. Until you connect your own, **strangers can't confirm an account or reset a password.**

1. Create an account with an email-sending service (Resend, Brevo, Postmark, Amazon SES; most have a free tier) and verify a sender address or domain there.
2. Supabase › Authentication › **SMTP settings**: enable custom SMTP and enter the host, port, user, password and From address the service gives you.
3. Supabase › Authentication › **Rate limits**: custom SMTP starts at 30 emails an hour. Raise it when you need to.

Optional: in Authentication › **Email templates**, reword "Confirm signup" and "Reset password". Keep `{{ .ConfirmationURL }}` in each.

## 4. Google

1. In [console.cloud.google.com](https://console.cloud.google.com), create a project named "PrepUp".
2. **Google Auth Platform › Branding** (or *OAuth consent screen*): app name PrepUp, your email, audience **External**. Publish it, or while it's in *Testing* add each tester.
3. **Clients › Create client › Web application**:
   - Authorized JavaScript origins: `https://<project>.vercel.app`
   - Authorized redirect URIs: `https://<ref>.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret**.
5. Supabase › Sign In / Providers › **Google**: enable, paste both, save.

## 5. GitHub

1. GitHub › Settings › Developer settings › **OAuth Apps › New OAuth App**:
   - Homepage URL: `https://<project>.vercel.app`
   - Authorization callback URL: `https://<ref>.supabase.co/auth/v1/callback`
2. Register it, then **Generate a new client secret**.
3. Supabase › Sign In / Providers › **GitHub**: enable, paste the Client ID and secret, save.

## 6. Show the buttons

Vercel › Settings › Environment Variables › set `AUTH_PROVIDERS` = `google,github`, then redeploy. Use just `google` if you set up only that one. The buttons stay hidden until this step, so nothing breaks halfway.

## 7. Check each way in

Use a private window and an email address that is **not** in your Supabase team.

| Try | You should see |
|---|---|
| Create account with a new email | "Check your email", then the link signs you in |
| Sign in with a wrong password | "That email and password don't match an account", with Reset password |
| Forgot password | An email; its link opens "Choose a new password" |
| Create account with an email already in use | "This email may already have an account" |
| Continue with Google, then GitHub | Your deck, each time |

**One account per email.** Supabase links sign-in methods that share a verified email, so Google and a password for the same address open the same deck. GitHub links only if your GitHub primary email is that address. If you sign in and the deck is unexpectedly empty, stop: a second account was created.

## What isn't covered

- **Changing a password while signed in.** Sign out and use Forgot password.
- **The connector's consent page** (`/oauth/consent`, shown when an AI app connects) has a simpler sign-in form of its own. People who already have an account are unaffected; the guide tells newcomers to sign up on the site first.
- **Leaked-password checks** are a paid Supabase feature.
