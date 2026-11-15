import { describe, expect, it } from "vitest";
import { signedInLabel } from "../src/lib/account.js";
import { legacyPath, movedPath, PATHS, screenFor, TITLES } from "../src/lib/route.js";

describe("addresses", () => {
  it("gives each screen its own address", () => {
    expect(screenFor("/")).toBe("deck");
    expect(screenFor("/guide")).toBe("guide");
    expect(screenFor("/settings")).toBe("settings");
    expect(screenFor("/costs")).toBe("costs");
    for (const [screen, path] of Object.entries(PATHS)) expect(screenFor(path)).toBe(screen);
  });

  it("gives the guide every address under /guide", () => {
    expect(screenFor("/guide/connect")).toBe("guide");
    expect(screenFor("/guide/no-such-page")).toBe("guide");
    expect(screenFor("/guidebook")).toBeNull();
  });

  it("forgives a trailing slash and refuses addresses it doesn't have", () => {
    expect(screenFor("/settings/")).toBe("settings");
    expect(screenFor("")).toBe("deck");
    expect(screenFor("/claude")).toBeNull();
    expect(screenFor("/settings/extra")).toBeNull();
    expect(screenFor("/Settings")).toBeNull();
  });

  it("sends renamed screens to what replaced them", () => {
    expect(movedPath("/claude")).toBe("/guide/connect");
    expect(movedPath("/claude/")).toBe("/guide/connect");
    expect(movedPath("/account")).toBe("/settings");
    expect(movedPath("/")).toBeNull();
    expect(movedPath("/guide")).toBeNull();
    // Wherever an old address leads, PrepUp has a screen for it.
    for (const old of ["/claude", "/account"]) expect(screenFor(movedPath(old)!)).not.toBeNull();
  });

  it("keeps old # links working", () => {
    expect(legacyPath("#/claude")).toBe("/guide/connect");
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
