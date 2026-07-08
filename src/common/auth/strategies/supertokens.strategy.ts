import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AdminAuthRequest, AdminAuthStrategy, AdminIdentity, LoginMethodDescriptor } from '../../../plugin-sdk';
import { extractBearer } from './extract-bearer';

export interface SupertokensStrategyOptions {
  /** JWKS endpoint of the SuperTokens core (e.g. https://st.example.org/auth/jwt/jwks.json). */
  jwksUrl?: string;
  /** Test seam: a local key source (jose `createLocalJWKSet`) instead of the remote JWKS. */
  keySource?: JWTVerifyGetKey;
}

/**
 * Built-in `supertokens` admin-auth strategy: plain SuperTokens session verification with a
 * configurable required role — deliberately WITHOUT the supertokens-node SDK.
 *
 * SuperTokens access tokens (header-based auth mode: `Authorization: Bearer <accessToken>`) are
 * JWTs verified against the core's JWKS (SUPERTOKENS_JWKS_URL): signature, `exp`, and — when
 * SUPERTOKENS_ISSUER is set — the issuer. The UserRoles recipe puts roles into the `st-role`
 * claim as `{ v: string[] }`; the identity is accepted only when ADMIN_SUPERTOKENS_ROLE
 * (default "admin") is present. Identity: `sub` claim (+ `email` claim as display name if present).
 *
 * Chain behavior: everything that does not verify (bad signature, expired, missing role/sub)
 * → null, so a later strategy (e.g. static-token) can still claim the request.
 */
export class SupertokensAdminAuthStrategy implements AdminAuthStrategy {
  private remoteJwks?: JWTVerifyGetKey;

  constructor(private readonly options: SupertokensStrategyOptions) {
    if (!options.keySource && !options.jwksUrl) {
      throw new Error('SupertokensAdminAuthStrategy requires a jwksUrl (SUPERTOKENS_JWKS_URL) or a keySource');
    }
  }

  async authenticate(req: AdminAuthRequest): Promise<AdminIdentity | null> {
    const accessToken = extractBearer(req);
    if (accessToken === undefined) return null;

    const issuer = (process.env.SUPERTOKENS_ISSUER ?? '').trim() || undefined;
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(accessToken, this.keySource(), issuer ? { issuer } : {}));
    } catch {
      return null; // Bad signature / expired / wrong issuer — not (or no longer) a valid session.
    }

    const requiredRole = (process.env.ADMIN_SUPERTOKENS_ROLE ?? '').trim() || 'admin';
    if (!this.rolesOf(payload).includes(requiredRole)) return null;

    const sub = payload['sub'];
    if (typeof sub !== 'string' || sub.length === 0) return null;
    const email = payload['email'];
    return { userId: sub, name: typeof email === 'string' ? email : undefined };
  }

  /**
   * Advertised only when SUPERTOKENS_LOGIN_URL is set — deployments may front their own login
   * and only use this strategy for token verification.
   */
  describeLoginMethod(): LoginMethodDescriptor | null {
    const authorizeUrl = (process.env.SUPERTOKENS_LOGIN_URL ?? '').trim();
    if (!authorizeUrl) return null;
    return { key: 'supertokens', flow: 'oidc-redirect', label: 'SuperTokens', params: { authorizeUrl } };
  }

  /** `st-role` claim of the UserRoles recipe: `{ v: string[] }`. Missing/malformed → no roles. */
  private rolesOf(payload: Record<string, unknown>): string[] {
    const claim = payload['st-role'];
    if (typeof claim !== 'object' || claim === null) return [];
    const values = (claim as { v?: unknown }).v;
    return Array.isArray(values) ? values.filter((role): role is string => typeof role === 'string') : [];
  }

  private keySource(): JWTVerifyGetKey {
    if (this.options.keySource) return this.options.keySource;
    return (this.remoteJwks ??= createRemoteJWKSet(new URL(this.options.jwksUrl as string)));
  }
}
