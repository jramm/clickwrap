import { AdminAuthError, type AdminAuthRequest, type AdminAuthStrategy, type AdminIdentity, type LoginMethodDescriptor } from '../../../plugin-sdk';
import {
  GoogleAuthLibraryTokenVerifier,
  type GoogleIdTokenClaims,
  type GoogleTokenVerifier,
} from '../google-token.verifier';
import { extractBearer } from './extract-bearer';

/**
 * Built-in `google-sso` admin-auth strategy (admin web UI, Google Identity Services):
 * `Authorization: Bearer <googleIdToken>` — signature/audience via {@link GoogleTokenVerifier},
 * `email_verified` required, domain restriction (ADMIN_ALLOWED_DOMAIN, required — fails CLOSED)
 * plus optional exact allowlist (ADMIN_ALLOWED_EMAILS).
 *
 * Chain behavior: no bearer / unconfigured / unverifiable token → null (another bearer strategy
 * may claim the request); a VERIFIED Google user failing a policy check → {@link AdminAuthError}
 * (specific 401, chain aborts). A broken token NEVER causes a 500.
 */
export class GoogleSsoAdminAuthStrategy implements AdminAuthStrategy {
  private defaultVerifier?: GoogleTokenVerifier;
  private defaultVerifierClientId?: string;

  constructor(private readonly injectedVerifier?: GoogleTokenVerifier) {}

  async authenticate(req: AdminAuthRequest): Promise<AdminIdentity | null> {
    const idToken = extractBearer(req);
    if (idToken === undefined) return null;

    const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
    if (!clientId) return null; // Google path disabled — the bearer may belong to another strategy.

    let claims: GoogleIdTokenClaims;
    try {
      claims = await this.resolveVerifier(clientId).verify(idToken);
    } catch {
      return null; // Not a valid Google ID token for this audience.
    }

    if (!claims.emailVerified) throw new AdminAuthError('E-mail address is not verified');

    const email = claims.email.trim().toLowerCase();
    // No default domain: an unset ADMIN_ALLOWED_DOMAIN must fail closed, never open up all domains.
    const domain = (process.env.ADMIN_ALLOWED_DOMAIN ?? '').trim().toLowerCase();
    if (!domain) {
      throw new AdminAuthError(
        'Admin domain restriction is not configured (ADMIN_ALLOWED_DOMAIN missing) — Google sign-in is disabled',
      );
    }
    if (!email.endsWith(`@${domain}`)) throw new AdminAuthError('E-mail domain is not allowed');

    const allowlist = (process.env.ADMIN_ALLOWED_EMAILS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
    if (allowlist.length > 0 && !allowlist.includes(email)) {
      throw new AdminAuthError('E-mail address is not on the allowlist');
    }

    return { userId: email, name: claims.name };
  }

  /** Advertised only when GOOGLE_CLIENT_ID is configured — the login page needs the client id. */
  describeLoginMethod(): LoginMethodDescriptor | null {
    const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
    if (!clientId) return null;
    return { key: 'google-sso', flow: 'google', label: 'Sign in with Google', params: { clientId } };
  }

  /** An injected fake (tests) takes precedence; otherwise a cached default verifier per GOOGLE_CLIENT_ID. */
  private resolveVerifier(clientId: string): GoogleTokenVerifier {
    if (this.injectedVerifier) return this.injectedVerifier;
    if (!this.defaultVerifier || this.defaultVerifierClientId !== clientId) {
      this.defaultVerifier = new GoogleAuthLibraryTokenVerifier(clientId);
      this.defaultVerifierClientId = clientId;
    }
    return this.defaultVerifier;
  }
}
