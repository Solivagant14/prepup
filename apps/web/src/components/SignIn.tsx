import type { SupabaseClient } from "@supabase/supabase-js";
import { useState, type FormEvent } from "react";

export function SignIn({ supabase }: { supabase: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <p className="muted" style={{ margin: 0 }}>
          Sign in with the account you use for the Claude connector.
        </p>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
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
        <p className="error" role="alert">
          {message}
        </p>
      </form>
    </main>
  );
}
