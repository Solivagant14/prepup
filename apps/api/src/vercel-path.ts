/**
 * Vercel routes every API path to one function and passes the original path
 * as `__path` (see scripts/build-vercel.mjs). Restoring it keeps routing
 * correct however the platform presents rewritten URLs.
 */
export function restorePath(rawUrl: string | undefined): string {
  const url = new URL(rawUrl ?? "/", "http://internal");
  const original = url.searchParams.get("__path");
  if (!original) return rawUrl ?? "/";
  url.searchParams.delete("__path");
  return `${original.startsWith("/") ? original : `/${original}`}${url.search}`;
}
