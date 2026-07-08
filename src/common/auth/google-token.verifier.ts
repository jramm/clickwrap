import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

/** Claims of a verified Google ID token, reduced to what is actually needed. */
export interface GoogleIdTokenClaims {
  email: string;
  emailVerified: boolean;
  name?: string;
  /** Hosted-domain claim (Google Workspace) — informational only; the e-mail domain check is authoritative. */
  hd?: string;
}

/**
 * Injectable seam around the Google verification. Tests inject a fake — real Google calls
 * NEVER happen in tests (see admin.guard.spec.ts).
 */
export interface GoogleTokenVerifier {
  /** Verifies signature + audience of the ID token. Throws on an invalid/expired token. */
  verify(idToken: string): Promise<GoogleIdTokenClaims>;
}

/** DI token for an optionally injected verifier (otherwise the guard builds a default one). */
export const GOOGLE_TOKEN_VERIFIER = Symbol('GOOGLE_TOKEN_VERIFIER');

/**
 * Production implementation: a thin wrapper around `google-auth-library`. Checks the signature
 * against Google's public keys and the audience against the configured GOOGLE_CLIENT_ID.
 */
@Injectable()
export class GoogleAuthLibraryTokenVerifier implements GoogleTokenVerifier {
  private readonly client: OAuth2Client;

  constructor(private readonly clientId: string) {
    this.client = new OAuth2Client(clientId);
  }

  async verify(idToken: string): Promise<GoogleIdTokenClaims> {
    const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId });
    const payload = ticket.getPayload();
    if (!payload?.email) throw new Error('Google ID token without an e-mail claim');
    return {
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name,
      hd: payload.hd,
    };
  }
}
