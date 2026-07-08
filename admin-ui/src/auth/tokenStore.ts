/**
 * Token store for the Google ID token (credential). Kept in memory AND in
 * localStorage (survives reloads and tab discards — mobile browsers drop sessionStorage aggressively). The API client reads
 * the token here without needing React context; on 401/403 a registered
 * listener triggers logout.
 */
const STORAGE_KEY = 'clickwrap-admin-id-token';
const DEV_TOKEN_KEY = 'clickwrap-admin-dev-token';

let inMemoryToken: string | null = null;
let inMemoryDevToken: string | null = null;
let authErrorListener: (() => void) | null = null;

export function getToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  try {
    inMemoryToken = localStorage.getItem(STORAGE_KEY);
  } catch {
    inMemoryToken = null;
  }
  return inMemoryToken;
}

export function setToken(token: string): void {
  inMemoryToken = token;
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* localStorage unavailable - in-memory is enough */
  }
}

export function clearToken(): void {
  inMemoryToken = null;
  inMemoryDevToken = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DEV_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Runtime dev admin token (from the login "token" method). Sent as
 * `x-admin-token` by the client and takes precedence over the build-time
 * VITE_DEV_ADMIN_TOKEN. Kept in localStorage like the id token.
 */
export function getDevAdminToken(): string | null {
  if (inMemoryDevToken) return inMemoryDevToken;
  try {
    inMemoryDevToken = localStorage.getItem(DEV_TOKEN_KEY);
  } catch {
    inMemoryDevToken = null;
  }
  return inMemoryDevToken;
}

export function setDevAdminToken(token: string): void {
  inMemoryDevToken = token;
  try {
    localStorage.setItem(DEV_TOKEN_KEY, token);
  } catch {
    /* localStorage unavailable - in-memory is enough */
  }
}

/** Registers the logout handler the client calls on 401/403. */
export function setAuthErrorListener(listener: (() => void) | null): void {
  authErrorListener = listener;
}

export function notifyAuthError(): void {
  authErrorListener?.();
}
