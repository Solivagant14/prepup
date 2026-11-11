import { describe, expect, it } from "vitest";
import { signedInLabel } from "../src/lib/account.js";
import { legacyPath, PATHS, screenFor, TITLES } from "../src/lib/route.js";

describe("addresses", () => {
  it("gives each screen its own address", () => {
    expect(screenFor("/")).toBe("deck");
    expect(screenFor("/claude")).toBe("claude");
    expect(screenFor("/account")).toBe("account");
    expect(screenFor("/costs")).toBe("costs");
    for (const [screen, path] of Object.entries(PATHS)) expect(screenFor(path)).toBe(screen);
  });

  it("forgives a trailing slash and refuses addresses it doesn't have", () => {
    expect(screenFor("/claude/")).toBe("claude");
    expect(screenFor("")).toBe("deck");
    expect(screenFor("/settings")).toBeNull();
    expect(screenFor("/claude/extra")).toBeNull();
    expect(screenFor("/Claude")).toBeNull();
  });

  it("keeps old # links working", () => {
    expect(legacyPath("#/claude")).toBe("/claude");
    expect(legacyPath("#/costs")).toBe("/costs");
    expect(legacyPath("#/")).toBe("/");
  });

  it("leaves other hashes alone, such as the one a sign-in provider returns with", () => {
    expect(legacyPath("")).toBeNull();
    expect(legacyPath("#access_token=abc&refresh_token=def")).toBeNull();
    expect(legacyPath("#/account")).toBeNull();
    expect(legacyPath("#error=access_denied")).toBeNull();
  });

  it("names every screen in the browser tab", () => {
    expect(new Set(Object.values(TITLES)).size).toBe(Object.keys(PATHS).length);
    for (const title of Object.values(TITLES)) expect(title).toContain("PrepUp");
  });
});

describe("who is signed in", () => {
  it("says how the person signed in when it knows", () => {
    expect(signedInLabel({ email: "a@example.com", provider: "google" })).toBe("Signed in with Google");
    expect(signedInLabel({ email: "a@example.com", provider: "github" })).toBe("Signed in with GitHub");
    expect(signedInLabel({ email: "a@example.com", provider: "email" })).toBe("Signed in with email");
  });

  it("falls back to a plain label for an unknown provider or none", () => {
    expect(signedInLabel({ email: "a@example.com", provider: "azure" })).toBe("Signed in");
    expect(signedInLabel({ email: null, provider: null })).toBe("Signed in");
    expect(signedInLabel(null)).toBe("Local development");
  });
});
