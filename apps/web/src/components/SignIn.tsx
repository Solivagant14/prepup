/**
 * The way in: sign in, create an account, or reset a password, by email or
 * through a sign-in provider. Each has its own form and one clear button, and
 * every failure says what happened and what to do next.
 */
import type { OAuthProvider } from "@prepup/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { HostLinkTargets } from "../lib/api.js";
import {
  authMessage,
  emailProblem,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordProblem,
  RESEND_WAIT_SECONDS,
  signUpOutcome,
  type AuthFailure,
  type AuthMessage,
  type AuthMode,
  type AuthNext,
} from "../lib/auth.js";
import { PATHS } from "../lib/route.js";
import { HostLinks } from "./HostLinks.js";
import { Link } from "./Link.js";
import { ProviderIcon, PROVIDER_LABEL, PROVIDER_NAME } from "./ProviderIcon.js";

const HEADING: Record<AuthMode, { title: string; lead: string }> = {
  in: { title: "Sign in to PrepUp", lead: "Welcome back. Your deck is where you left it." },
  up: { title: "Create your account", lead: "Free to use. It takes a minute." },
  forgot: { title: "Reset your password", lead: "Enter your email and we'll send you a link to choose a new one." },
};

const NEXT_LABEL: Record<AuthNext, string> = {
  reset: "Reset password",
  resend: "Send the link again",
  "sign-in": "Sign in instead",
  "sign-up": "Create an account",
};

/** Counts down the wait before another email can be asked for. */
function useCooldown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return { left, start: () => setLeft(RESEND_WAIT_SECONDS) };
}

/** A password box with a button to show what was typed, so nobody has to type it twice. */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  problem,
  hint,
  aside,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  problem?: string | null | undefined;
  hint?: string;
  aside?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const note = problem ?? hint;
  return (
    <div className="auth-field">
      <div className="auth-label">
        <label htmlFor={id}>{label}</label>
        {aside}
      </div>
      <div className="auth-password">
        <input
          id={id}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          maxLength={PASSWORD_MAX}
          value={value}
          aria-invalid={problem ? true : undefined}
          aria-describedby={note ? `${id}-note` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" aria-pressed={shown} aria-controls={id} onClick={() => setShown((s) => !s)}>
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {note && (
        <p id={`${id}-note`} className={problem ? "auth-problem" : "auth-hint"}>
          {note}
        </p>
      )}
    </div>
  );
}

/** The frame both sign-in screens share: what PrepUp is on one side, the form on the other. */
export function AuthFrame({ links, children }: { links: HostLinkTargets; children: ReactNode }) {
  return (
    <main className="auth">
      <aside className="auth-pitch">
        <p className="auth-brand">PrepUp</p>
        <h2>Know what you know.</h2>
        <ul>
          <li>
            <strong>Add a term</strong> the moment you hear it.
          </li>
          <li>
            <strong>Get tested</strong> by an AI assistant you already use.
          </li>
          <li>
            <strong>Watch your deck darken</strong> as it sticks, and fade when you leave it.
          </li>
        </ul>
        <Link to={PATHS.guide} className="auth-more">
          See how it works
        </Link>
      </aside>
      <section className="auth-card">
        <p className="auth-brand small">PrepUp</p>
        {children}
        <HostLinks links={links} showGuide />
      </section>
    </main>
  );
}

export function SignIn({
  supabase,
  providers,
  links,
  arrival,
}: {
  supabase: SupabaseClient;
  providers: OAuthProvider[];
  links: HostLinkTargets;
  /** Something a link or a sign-in provider brought back, such as "that link has expired". */
  arrival?: AuthMessage | null;
}) {
  const [mode, setMode] = useState<AuthMode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<{ email?: string | null; password?: string | null }>({});
  const [message, setMessage] = useState<AuthMessage | null>(arrival ?? null);
  const [busy, setBusy] = useState<"email" | OAuthProvider | null>(null);
  /** Set once an email is on its way: the form gives way to "check your email". */
  const [sent, setSent] = useState<{ kind: "confirm" | "reset"; email: string } | null>(null);
  const cooldown = useCooldown();
  const form = useRef<HTMLFormElement>(null);
  const back = window.location.origin;

  const go = (next: AuthMode) => {
    setMode(next);
    setMessage(null);
    setProblems({});
    setSent(null);
    if (next !== "in") setPassword("");
  };
  const fail = (error: AuthFailure) => setMessage(authMessage(error));

  // Leaves for Google or GitHub; the provider brings the person back here signed in.
  async function social(provider: OAuthProvider) {
    setMessage(null);
    setBusy(provider);
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: back } });
    if (error) {
      setBusy(null);
      fail(error);
    }
  }

  async function sendConfirmation(address: string) {
    const { error } = await supabase.auth.resend({ type: "signup", email: address, options: { emailRedirectTo: back } });
    if (error) return fail(error);
    setMessage(null);
    setSent({ kind: "confirm", email: address });
    cooldown.start();
  }

  async function sendReset(address: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: back });
    if (error) return fail(error);
    setMessage(null);
    setSent({ kind: "reset", email: address });
    cooldown.start();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const address = email.trim();
    const found = {
      email: emailProblem(address),
      // Signing in, any password may be the right one; only a new password is held to the rules.
      password: mode === "up" ? passwordProblem(password) : mode === "in" && !password ? "Enter your password." : null,
    };
    setProblems(found);
    setMessage(null);
    if (found.email || found.password) {
      form.current?.querySelector<HTMLInputElement>(found.email ? "#auth-email" : "#auth-password")?.focus();
      return;
    }

    setBusy("email");
    try {
      if (mode === "forgot") return await sendReset(address);
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email: address, password });
        if (error) fail(error);
        return;
      }
      const { data, error } = await supabase.auth.signUp({ email: address, password, options: { emailRedirectTo: back } });
      if (error) return fail(error);
      const outcome = signUpOutcome(data);
      if (outcome === "exists") {
        setMessage({ text: "This email may already have an account. Sign in, or reset your password.", next: "sign-in" });
      } else if (outcome === "confirm") {
        setSent({ kind: "confirm", email: address });
        cooldown.start();
      }
    } catch (thrown) {
      fail(thrown as AuthFailure);
    } finally {
      setBusy(null);
    }
  }

  const follow = (next: AuthNext) => {
    if (next === "reset") go("forgot");
    else if (next === "sign-in") go("in");
    else if (next === "sign-up") go("up");
    else if (emailProblem(email)) setProblems({ email: emailProblem(email) });
    else void sendConfirmation(email.trim());
  };

  const alert = message && (
    <div className="auth-alert" role="alert">
      <span>{message.text}</span>
      {message.next && (
        <button type="button" className="auth-link" onClick={() => follow(message.next!)}>
          {NEXT_LABEL[message.next]}
        </button>
      )}
    </div>
  );

  if (sent) {
    return (
      <AuthFrame links={links}>
        <h1>Check your email</h1>
        <p className="auth-lead">
          {sent.kind === "confirm" ? (
            <>
              We sent a link to <strong>{sent.email}</strong>. Open it to confirm your account and sign in.
            </>
          ) : (
            <>
              If <strong>{sent.email}</strong> has an account, a link to choose a new password is on its way.
            </>
          )}
        </p>
        <p className="auth-hint">It can take a minute. Look in your spam folder too.</p>
        {alert}
        <button
          type="button"
          className="btn auth-wide"
          disabled={cooldown.left > 0}
          onClick={() => void (sent.kind === "confirm" ? sendConfirmation(sent.email) : sendReset(sent.email))}
        >
          {cooldown.left > 0 ? `Send again in ${cooldown.left}s` : "Send the email again"}
        </button>
        <p className="auth-switch">
          <button type="button" className="auth-link" onClick={() => go(sent.kind === "confirm" ? "up" : "forgot")}>
            Use a different email
          </button>
          <button type="button" className="auth-link" onClick={() => go("in")}>
            Back to sign in
          </button>
        </p>
      </AuthFrame>
    );
  }

  const { title, lead } = HEADING[mode];
  return (
    <AuthFrame links={links}>
      <h1>{title}</h1>
      <p className="auth-lead">{lead}</p>

      {mode !== "forgot" && providers.length > 0 && (
        <>
          <div className="auth-providers">
            {providers.map((p) => (
              <button key={p} type="button" className="btn social" disabled={busy !== null} onClick={() => void social(p)}>
                <ProviderIcon provider={p} />
                {busy === p ? `Opening ${PROVIDER_NAME[p]}…` : PROVIDER_LABEL[p]}
              </button>
            ))}
          </div>
          <div className="divider">or with email</div>
        </>
      )}

      <form ref={form} onSubmit={(e) => void submit(e)} noValidate>
        <div className="auth-field">
          <div className="auth-label">
            <label htmlFor="auth-email">Email</label>
          </div>
          <input
            id="auth-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            aria-invalid={problems.email ? true : undefined}
            aria-describedby={problems.email ? "auth-email-note" : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
          {problems.email && (
            <p id="auth-email-note" className="auth-problem">
              {problems.email}
            </p>
          )}
        </div>

        {mode !== "forgot" && (
          <PasswordField
            id="auth-password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete={mode === "up" ? "new-password" : "current-password"}
            problem={problems.password}
            {...(mode === "up" ? { hint: `At least ${PASSWORD_MIN} characters.` } : {})}
            aside={
              mode === "in" && (
                <button type="button" className="auth-link" onClick={() => go("forgot")}>
                  Forgot password?
                </button>
              )
            }
          />
        )}

        {alert}

        <button type="submit" className="btn primary auth-wide" disabled={busy !== null}>
          {mode === "in"
            ? busy === "email"
              ? "Signing in…"
              : "Sign in"
            : mode === "up"
              ? busy === "email"
                ? "Creating your account…"
                : "Create account"
              : busy === "email"
                ? "Sending…"
                : "Send reset link"}
        </button>
      </form>

      <p className="auth-switch">
        {mode === "in" ? (
          <>
            New to PrepUp?{" "}
            <button type="button" className="auth-link" onClick={() => go("up")}>
              Create an account
            </button>
          </>
        ) : (
          <>
            {mode === "up" ? "Already have an account? " : "Remembered it? "}
            <button type="button" className="auth-link" onClick={() => go("in")}>
              Sign in
            </button>
          </>
        )}
      </p>
      {mode !== "forgot" && (
        <p className="auth-hint center">If you've already connected an AI app, use the same account here.</p>
      )}
    </AuthFrame>
  );
}

/** Where a password-reset link lands: choose the new password, then carry on into the deck. */
export function NewPassword({
  supabase,
  links,
  onDone,
}: {
  supabase: SupabaseClient;
  links: HostLinkTargets;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<AuthMessage | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = passwordProblem(password);
    setProblem(found);
    setMessage(null);
    if (found || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) setMessage(authMessage(error));
      else onDone();
    } catch (thrown) {
      setMessage(authMessage(thrown as AuthFailure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame links={links}>
      <h1>Choose a new password</h1>
      <p className="auth-lead">You're signed in. Set a new password to use from now on.</p>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <PasswordField
          id="auth-password"
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          problem={problem}
          hint={`At least ${PASSWORD_MIN} characters.`}
        />
        {message && (
          <div className="auth-alert" role="alert">
            <span>{message.text}</span>
          </div>
        )}
        <button type="submit" className="btn primary auth-wide" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
      <p className="auth-switch">
        <button type="button" className="auth-link" onClick={onDone}>
          Not now
        </button>
      </p>
    </AuthFrame>
  );
}
