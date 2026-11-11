/** Who is signed in, and how to say so. */

/** Who is signed in. Null when the API runs without sign-in (local development). */
export interface AccountInfo {
  email: string | null;
  provider: string | null;
}

const PROVIDER_NAME: Record<string, string> = { google: "Google", github: "GitHub", email: "email" };

/** "Signed in with Google", or a plain "Signed in" when we can't tell how. */
export function signedInLabel(account: AccountInfo | null): string {
  if (!account) return "Local development";
  const name = account.provider ? PROVIDER_NAME[account.provider] : undefined;
  return name ? `Signed in with ${name}` : "Signed in";
}
