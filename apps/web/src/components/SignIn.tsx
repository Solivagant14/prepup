import type { OAuthProvider } from "@prepup/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useState, type FormEvent } from "react";
import type { HostLinkTargets } from "../lib/api.js";
import { HostLinks } from "./HostLinks.js";
import { ProviderIcon, PROVIDER_LABEL } from "./ProviderIcon.js";

export function SignIn({
  supabase,
  providers,
  links,
}: {
  supabase: SupabaseClient;
  providers: OAuthProvider[];
  links: HostLinkTargets;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // With a one-tap sign-in on offer, the email form waits behind a link.
  const [withEmail, setWithEmail] = useState(providers.length === 0);

  // Leaves for Google or GitHub; Supabase brings you back here signed in.
  async function social(provider: OAuthProvider) {
    setMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
    if (error) setMessage(error.message);
  }

  async function submit(mode: "in" | "up", e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMessage(null);
    const creds = { email, password };
    const { data, error } =
      mode === "up" ? await supabase.auth.signUp(creds) : await supabase.auth.signInWithPassword(creds);
    setBusy(false);
    if (error) return setMessage(error.message);
    if (!data.session) setMessage("Check your email to confirm your account, then sign in.");
  }

  return (
    <main className="auth">
      <form onSubmit={(e) => void submit("in", e)}>
        <h1>PrepUp</h1>
        <p className="auth-lead">
          Keep track of what you're learning. Add a term the moment you hear it, let your own Claude test you on it, and
          watch your deck darken as it sticks.
        </p>
        <p className="muted auth-hint">Free to use. If you've connected Claude already, sign in with the same account.</p>
        {providers.map((p, i) => (
          <button key={p} type="button" className={`btn social${i === 0 ? " primary" : ""}`} onClick={() => void social(p)}>
            <ProviderIcon provider={p} />
            {PROVIDER_LABEL[p]}
          </button>
        ))}
        {providers.length > 0 && !withEmail && (
          <button type="button" className="link-btn auth-switch" onClick={() => setWithEmail(true)}>
            Use email and password instead
          </button>
        )}
        {withEmail && (
          <>
            {providers.length > 0 && <div className="divider">or with email</div>}
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                autoFocus={providers.length > 0}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <div className="row">
              <button type="button" className="btn" disabled={busy} onClick={() => void submit("up")}>
                Create account
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                Sign in
              </button>
            </div>
          </>
        )}
        <p className="error" role="alert">
          {message}
        </p>
        <HostLinks links={links} />
      </form>
    </main>
  );
}
