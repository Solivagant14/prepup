/**
 * Supabase's OAuth server needs the app to host a consent screen. When Claude
 * starts the connector login, Supabase sends the user here with an
 * authorization_id; the user signs in and approves, and Supabase redirects
 * back to Claude with a code. This is a minimal M0 version; the real web app
 * replaces it in M2.
 */
const SUPABASE_JS = "https://esm.sh/@supabase/supabase-js@2.117.3";

const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export function consentPage(supabaseUrl: string, publishableKey: string, nonce: string): string {
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
  button { flex:1; height:44px; border-radius:8px; border:1px solid var(--btn); background:var(--btn); color:var(--btnInk); font:inherit; font-weight:500; cursor:pointer; }
  button.secondary { background:transparent; color:var(--ink); border-color:var(--line); }
  [hidden] { display:none !important; }
  #error { color:#BE4C6A; }
  .spaced { margin-top:16px; }
</style>
</head>
<body>
<main>
  <h1>Connect to PrepUp</h1>
  <p id="status">Loading…</p>
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

  $("signin").addEventListener("submit", (e) => { e.preventDefault(); signIn("in"); });
  $("signup").addEventListener("click", () => signIn("up"));
  $("approve").addEventListener("click", () => decide(true));
  $("deny").addEventListener("click", () => decide(false));

  if (!authorizationId) {
    $("status").textContent = "Open this page from Claude's connector setup.";
  } else {
    const { data } = await supabase.auth.getSession();
    if (data.session) await showConsent();
    else { $("status").textContent = "Sign in to let Claude use your PrepUp deck."; $("signin").hidden = false; }
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
