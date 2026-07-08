/**
 * Decodes the claims of a Google ID token (JWT). There is NO signature
 * verification — that happens server-side in the backend. Here only display
 * data (name, email, avatar) for the user chip is read.
 */
export interface GoogleClaims {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  exp?: number;
}

export function decodeGoogleToken(idToken: string): GoogleClaims | null {
  const parts = idToken.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
    const claims = JSON.parse(json) as GoogleClaims;
    return typeof claims.sub === 'string' ? claims : null;
  } catch {
    return null;
  }
}

export function isExpired(claims: GoogleClaims | null): boolean {
  if (!claims?.exp) return false;
  return claims.exp * 1000 < Date.now();
}
