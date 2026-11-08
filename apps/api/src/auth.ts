/**
 * PrepUp is an OAuth *resource server*: it never sees passwords. Supabase
 * Auth is the authorization server. Claude (or the web app) gets a token from
 * Supabase and sends it as a Bearer header; we verify its signature against
 * Supabase's published keys (JWKS) and read the user id from `sub`.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthenticatedUser {
  userId: string;
  /** Which OAuth client the token was issued to (e.g. Claude), when present. */
  clientId?: string;
}

export interface Authenticator {
  authenticate(request: Request): Promise<AuthenticatedUser | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export class SupabaseAuthenticator implements Authenticator {
  private readonly issuer: string;
  private readonly keys: JWTVerifyGetKey;

  constructor(supabaseUrl: string, keys?: JWTVerifyGetKey) {
    this.issuer = `${supabaseUrl}/auth/v1`;
    this.keys = keys ?? createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
  }

  async authenticate(request: Request): Promise<AuthenticatedUser | null> {
    const token = bearer(request);
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.keys, { issuer: this.issuer });
      if (typeof payload.sub !== "string" || !UUID.test(payload.sub)) return null;
      if (payload.role !== undefined && payload.role !== "authenticated") return null;
      const clientId = typeof payload.client_id === "string" ? payload.client_id : undefined;
      return clientId ? { userId: payload.sub, clientId } : { userId: payload.sub };
    } catch {
      return null;
    }
  }
}

/**
 * Local development only: trusts an `x-dev-user-id` header. The config
 * refuses this mode when NODE_ENV=production.
 */
export class DevAuthenticator implements Authenticator {
  async authenticate(request: Request): Promise<AuthenticatedUser | null> {
    const id = request.headers.get("x-dev-user-id");
    return id && UUID.test(id) ? { userId: id } : null;
  }
}
