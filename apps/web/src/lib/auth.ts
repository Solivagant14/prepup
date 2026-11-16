/**
 * The words and checks behind the sign-in screen, kept apart from it so they
 * can be tested. The sign-in service answers in codes meant for programmers;
 * this turns each into a sentence that says what happened and what to do next.
 */

export type AuthMode = "in" | "up" | "forgot";

/** Shortest password the screen accepts. Set the sign-in service to the same number. */
export const PASSWORD_MIN = 8;
/** Longer than any real password, short enough to stop a pasted document. */
export const PASSWORD_MAX = 72;

/** A follow-up the screen can offer beside a message. */
export type AuthNext = "reset" | "resend" | "sign-in" | "sign-up";

export interface AuthMessage {
  text: string;
  next?: AuthNext;
}

/** What we need from an error thrown by the sign-in service. */
export interface AuthFailure {
  code?: string | undefined;
  status?: number | undefined;
  message?: string | undefined;
  name?: string | undefined;
}

const BY_CODE: Record<string, AuthMessage> = {
  invalid_credentials: { text: "That email and password don't match an account. Check them, or reset your password.", next: "reset" },
  email_not_confirmed: { text: "Confirm your email first. We sent you a link when you signed up.", next: "resend" },
  user_already_exists: { text: "An account with this email already exists. Sign in instead.", next: "sign-in" },
  email_exists: { text: "An account with this email already exists. Sign in instead.", next: "sign-in" },
  weak_password: { text: "Choose a stronger password: longer, and not one that's easy to guess." },
  same_password: { text: "That's your current password. Choose a different one." },
  signup_disabled: { text: "New sign-ups are closed on this copy of PrepUp." },
  email_provider_disabled: { text: "Email sign-in is turned off here. Use one of the buttons above." },
  provider_disabled: { text: "That sign-in option is turned off here. Try another." },
  email_address_invalid: { text: "That email address doesn't look right. Check it and try again." },
  email_address_not_authorized: { text: "We couldn't send an email to that address. Try another, or sign in a different way." },
  over_email_send_rate_limit: { text: "Too many emails sent for now. Wait a few minutes, then try again." },
  over_request_rate_limit: { text: "Too many attempts. Wait a minute, then try again." },
  otp_expired: { text: "That link has expired or was already used. Ask for a new one.", next: "reset" },
  user_banned: { text: "This account has been suspended." },
  session_expired: { text: "Your session ended. Sign in again." },
};

/** A sentence for whatever the sign-in service said went wrong. */
export function authMessage(error: AuthFailure): AuthMessage {
  if (error.code && BY_CODE[error.code]) return BY_CODE[error.code]!;
  // The service was never reached: offline, blocked, or it is down.
  if (error.status === 0 || error.name === "AuthRetryableFetchError" || /failed to fetch|network/i.test(error.message ?? "")) {
    return { text: "Couldn't reach the sign-in service. Check your connection and try again." };
  }
  if (error.status === 429) return BY_CODE.over_request_rate_limit!;
  // Older responses carry no code; these are the ones people actually meet.
  const said = error.message ?? "";
  if (/invalid login credentials/i.test(said)) return BY_CODE.invalid_credentials!;
  if (/email not confirmed/i.test(said)) return BY_CODE.email_not_confirmed!;
  if (/already registered/i.test(said)) return BY_CODE.user_already_exists!;
  return { text: "Something went wrong while signing you in. Try again in a moment." };
}

/** Why an email can't be used, or null when it can. A light check: the service has the last word. */
export function emailProblem(email: string): string | null {
  const value = email.trim();
  if (!value) return "Enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "That email address doesn't look right.";
  return null;
}

/** Why a new password can't be used, or null when it can. */
export function passwordProblem(password: string): string | null {
  if (!password) return "Choose a password.";
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (password.trim() !== password) return "A password can't start or end with a space.";
  return null;
}

/**
 * What a sign-up attempt led to. When email confirmation is on, the service
 * answers an already-used address with a stand-in account that has no
 * sign-in methods, so that it never confirms who has an account.
 */
export function signUpOutcome(data: {
  session: unknown;
  user: { identities?: unknown[] | null | undefined } | null;
}): "signed-in" | "confirm" | "exists" {
  if (data.session) return "signed-in";
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return "exists";
  return "confirm";
}

/** What a link or a sign-in provider brought back to the page, read from the address. */
export interface Arrival {
  /** Set when the trip failed: an expired link, a cancelled Google sign-in. */
  message: AuthMessage | null;
  /** True when a password-reset link was followed, so the next screen asks for a new password. */
  recovery: boolean;
}

export function readArrival(hash: string, search: string): Arrival {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const query = new URLSearchParams(search);
  const get = (key: string) => params.get(key) ?? query.get(key);
  const recovery = get("type") === "recovery";
  if (!get("error") && !get("error_code")) return { message: null, recovery };
  const code = get("error_code") ?? undefined;
  if (code && BY_CODE[code]) return { message: BY_CODE[code]!, recovery: false };
  // Someone pressed Cancel on the provider's own screen.
  if (get("error") === "access_denied") return { message: { text: "Sign-in was cancelled. Try again when you're ready." }, recovery: false };
  return { message: { text: "That sign-in didn't complete. Try again." }, recovery: false };
}

/** Seconds to wait before another email can be asked for, so a double tap doesn't hit the send limit. */
export const RESEND_WAIT_SECONDS = 60;
