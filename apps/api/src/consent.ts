/**
 * Supabase's OAuth server needs the app to host a consent screen. When Claude
 * starts the connector login, Supabase sends the user here with an
 * authorization_id; the user signs in and approves, and Supabase redirects
 * back to Claude with a code. This is a minimal M0 version; the real web app
 * replaces it in M2.
 */
import type { OAuthProvider } from "@prepup/contracts";

const SUPABASE_JS = "https://esm.sh/@supabase/supabase-js@2.117.3";

const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/** Official brand marks for the sign-in buttons. */
export const PROVIDER_UI: Record<OAuthProvider, { label: string; icon: string }> = {
  google: {
    label: "Continue with Google",
    icon: '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
  },
  github: {
    label: "Continue with GitHub",
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3"/></svg>',
  },
};

export function consentPage(
  supabaseUrl: string,
  publishableKey: string,
  nonce: string,
  providers: readonly OAuthProvider[] = [],
): string {
  const socialButtons = providers
    .map((p) => `<button type="button" class="social" data-provider="${p}">${PROVIDER_UI[p].icon}<span>${PROVIDER_UI[p].label}</span></button>`)
    .join("\n    ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to PrepUp</title>
<style nonce="${nonce}">
  :root { color-scheme: light; --bg:#FAFAFA; --ink:#18181B; --muted:#71717A; --line:#E4E4E7; --btn:#18181B; --btnInk:#FFFFFF; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui, sans-serif; padding:16px; }
  main { width:100%; max-width:380px; display:flex; flex-direction:column; gap:16px; }
  h1 { margin:0; font-size:22px; font-weight:500; letter-spacing:-0.01em; }
  p { margin:0; color:var(--muted); }
  label { display:flex; flex-direction:column; gap:6px; font-size:13px; font-weight:500; }
  input { height:44px; padding:0 12px; border:1px solid var(--line); border-radius:8px; background:transparent; color:var(--ink); font:inherit; }
  .row { display:flex; gap:8px; }
  .stack { display:flex; flex-direction:column; gap:10px; }
  button { flex:1; height:44px; border-radius:8px; border:1px solid var(--btn); background:var(--btn); color:var(--btnInk); font:inherit; font-weight:500; cursor:pointer; }
  button.secondary { background:transparent; color:var(--ink); border-color:var(--line); }
  [hidden] { display:none !important; }
  #error { color:#BE4C6A; }
  .spaced { margin-top:16px; }
  .social { display:flex; align-items:center; justify-content:center; gap:10px; width:100%; background:#FFFFFF; color:var(--ink); border-color:var(--line); }
  .social:hover { border-color:#A1A1AA; }
  .divider { display:flex; align-items:center; gap:12px; color:var(--muted); font-size:13px; }
  .divider::before, .divider::after { content:""; flex:1; height:1px; background:var(--line); }
</style>
</head>
<body>
<main>
  <h1>Connect to PrepUp</h1>
  <p id="status">Loading…</p>
  <div id="social" class="stack" hidden>
    ${socialButtons}
    <div class="divider">or with email</div>
  </div>
  <form id="signin" hidden>
    <label>Email <input id="email" type="email" autocomplete="email" required></label>
    <label>Password <input id="password" type="password" autocomplete="current-password" required minlength="8"></label>
    <div class="row">
      <button type="submit">Sign in</button>
      <button type="button" class="secondary" id="signup">Create account</button>
    </div>
  </form>
  <div id="consent" hidden>
    <p id="ask"></p>
    <div class="row spaced">
      <button type="button" class="secondary" id="deny">Deny</button>
      <button type="button" id="approve">Allow</button>
    </div>
  </div>
  <p id="error" role="alert"></p>
</main>
<script type="module" nonce="${nonce}">
  import { createClient } from "${SUPABASE_JS}";
  const supabase = createClient(${json(supabaseUrl)}, ${json(publishableKey)});
  const $ = (id) => document.getElementById(id);
  const authorizationId = new URLSearchParams(location.search).get("authorization_id");
  const fail = (msg) => { $("error").textContent = msg; };

  async function showConsent() {
    $("signin").hidden = true;
    $("social").hidden = true;
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error) return fail(error.message);
    if (data.redirect_url && !data.authorization_id) { location.assign(data.redirect_url); return; }
    const client = data.client?.name || data.client?.client_name || "An app";
    $("status").textContent = "Signed in.";
    $("ask").textContent = client + " wants to read and update your PrepUp topics.";
    $("consent").hidden = false;
  }

  async function decide(approve) {
    const fn = approve ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization;
    const { data, error } = await fn.call(supabase.auth.oauth, authorizationId);
    if (error) return fail(error.message);
    location.assign(data.redirect_url);
  }

  async function signIn(mode) {
    fail("");
    const creds = { email: $("email").value, password: $("password").value };
    const { data, error } = mode === "up" ? await supabase.auth.signUp(creds) : await supabase.auth.signInWithPassword(creds);
    if (error) return fail(error.message);
    if (!data.session) { $("status").textContent = "Check your email to confirm your account, then come back to this page."; return; }
    await showConsent();
  }

  // Social sign-in leaves for Google or GitHub, then comes back to this exact
  // page (authorization_id included) to finish the Claude connection.
  for (const btn of document.querySelectorAll("[data-provider]")) {
    btn.addEventListener("click", async () => {
      fail("");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: btn.dataset.provider,
        options: { redirectTo: location.href },
      });
      if (error) fail(error.message);
    });
  }

  $("signin").addEventListener("submit", (e) => { e.preventDefault(); signIn("in"); });
  $("signup").addEventListener("click", () => signIn("up"));
  $("approve").addEventListener("click", () => decide(true));
  $("deny").addEventListener("click", () => decide(false));

  if (!authorizationId) {
    $("status").textContent = "Open this page from Claude's connector setup.";
  } else {
    const { data } = await supabase.auth.getSession();
    if (data.session) await showConsent();
    else {
      $("status").textContent = "Sign in to let Claude use your PrepUp deck.";
      $("signin").hidden = false;
      $("social").hidden = ${providers.length === 0 ? "true" : "false"};
    }
  }
</script>
</body>
</html>`;
}

/** Locks the consent page down to its own script and Supabase. */
export function consentCsp(supabaseUrl: string, nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://esm.sh`,
    `style-src 'nonce-${nonce}'`,
    `connect-src ${supabaseUrl} https://esm.sh`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
