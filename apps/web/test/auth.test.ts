import { describe, expect, it } from "vitest";
import { authMessage, emailProblem, PASSWORD_MAX, PASSWORD_MIN, passwordProblem, readArrival, signUpOutcome } from "../src/lib/auth.js";

describe("what a sign-in failure says", () => {
  it("explains a wrong email or password and offers a reset, without saying which was wrong", () => {
    const m = authMessage({ code: "invalid_credentials", status: 400, message: "Invalid login credentials" });
    expect(m.next).toBe("reset");
    expect(m.text).toMatch(/email and password don't match/);
    expect(m.text).not.toMatch(/Invalid login credentials/);
  });

  it("offers the right next step for each common case", () => {
    expect(authMessage({ code: "email_not_confirmed" }).next).toBe("resend");
    expect(authMessage({ code: "user_already_exists" }).next).toBe("sign-in");
    expect(authMessage({ code: "email_exists" }).next).toBe("sign-in");
    expect(authMessage({ code: "otp_expired" }).next).toBe("reset");
    expect(authMessage({ code: "weak_password" }).next).toBeUndefined();
  });

  it("tells a rate limit from a failure to connect", () => {
    expect(authMessage({ code: "over_request_rate_limit" }).text).toMatch(/Too many attempts/);
    expect(authMessage({ code: "over_email_send_rate_limit" }).text).toMatch(/Too many emails/);
    expect(authMessage({ status: 429, message: "rate limited" }).text).toMatch(/Too many attempts/);
    expect(authMessage({ name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" }).text).toMatch(/Couldn't reach/);
    expect(authMessage({ message: "TypeError: Failed to fetch" }).text).toMatch(/Couldn't reach/);
  });

  it("understands older replies that carry only a message", () => {
    expect(authMessage({ message: "Invalid login credentials" }).next).toBe("reset");
    expect(authMessage({ message: "Email not confirmed" }).next).toBe("resend");
    expect(authMessage({ message: "User already registered" }).next).toBe("sign-in");
  });

  it("never shows a raw service message it doesn't recognise", () => {
    const m = authMessage({ code: "unexpected_failure", status: 500, message: "pq: relation \"auth.users\" does not exist" });
    expect(m.text).toBe("Something went wrong while signing you in. Try again in a moment.");
  });
});

describe("checks before anything is sent", () => {
  it("wants something that looks like an email", () => {
    expect(emailProblem("")).toMatch(/Enter your email/);
    expect(emailProblem("   ")).toMatch(/Enter your email/);
    for (const bad of ["nishant", "a@b", "a b@c.com", "@c.com", "a@.com "]) expect(emailProblem(bad), bad).not.toBeNull();
    for (const good of ["a@b.co", " learner+prep@example.com ", "x.y@sub.example.org"]) expect(emailProblem(good), good).toBeNull();
  });

  it("holds a new password to a length, and says which way it's wrong", () => {
    expect(passwordProblem("")).toMatch(/Choose a password/);
    expect(passwordProblem("a".repeat(PASSWORD_MIN - 1))).toBe(`Use at least ${PASSWORD_MIN} characters.`);
    expect(passwordProblem("a".repeat(PASSWORD_MIN))).toBeNull();
    expect(passwordProblem("a".repeat(PASSWORD_MAX))).toBeNull();
    expect(passwordProblem("a".repeat(PASSWORD_MAX + 1))).toMatch(/at most/);
    expect(passwordProblem(" leading space")).toMatch(/space/);
    expect(passwordProblem("a perfectly fine passphrase")).toBeNull();
  });
});

describe("what a sign-up led to", () => {
  it("is signed in when the service returns a session", () => {
    expect(signUpOutcome({ session: { access_token: "x" }, user: { identities: [{}] } })).toBe("signed-in");
  });

  it("waits for the email to be confirmed otherwise", () => {
    expect(signUpOutcome({ session: null, user: { identities: [{ provider: "email" }] } })).toBe("confirm");
    expect(signUpOutcome({ session: null, user: {} })).toBe("confirm");
    expect(signUpOutcome({ session: null, user: null })).toBe("confirm");
  });

  it("spots the stand-in account the service returns for an address already in use", () => {
    expect(signUpOutcome({ session: null, user: { identities: [] } })).toBe("exists");
  });
});

describe("what a link or a provider brought back", () => {
  it("is nothing for an ordinary visit or a successful sign-in", () => {
    expect(readArrival("", "")).toEqual({ message: null, recovery: false });
    expect(readArrival("#access_token=abc&refresh_token=def&type=signup", "")).toEqual({ message: null, recovery: false });
    expect(readArrival("", "?app=cursor")).toEqual({ message: null, recovery: false });
  });

  it("notices a password-reset link", () => {
    expect(readArrival("#access_token=abc&refresh_token=def&type=recovery", "")).toEqual({ message: null, recovery: true });
  });

  it("explains an expired or used link, in the hash or in the query", () => {
    const hash = readArrival("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", "");
    expect(hash.message?.text).toMatch(/expired or was already used/);
    expect(hash.recovery).toBe(false);
    expect(readArrival("", "?error=access_denied&error_code=otp_expired").message?.next).toBe("reset");
  });

  it("explains a cancelled provider sign-in without echoing the provider's words", () => {
    const m = readArrival("", "?error=access_denied&error_description=<script>alert(1)</script>").message;
    expect(m?.text).toBe("Sign-in was cancelled. Try again when you're ready.");
    expect(readArrival("#error=server_error&error_description=boom", "").message?.text).toBe("That sign-in didn't complete. Try again.");
  });
});
