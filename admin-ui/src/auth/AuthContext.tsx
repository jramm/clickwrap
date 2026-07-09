import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { decodeGoogleToken, isExpired } from './googleToken';
import type { GoogleClaims } from './googleToken';
import {
  clearToken,
  getDevAdminToken,
  getToken,
  setAuthErrorListener,
  setDevAdminToken,
  setToken,
} from './tokenStore';

/**
 * Auth state of the app. Holds either a Google ID token (with decoded display
 * claims) or an opaque static/dev admin token — both via tokenStore (in memory +
 * localStorage), so a session survives a page reload. Registers a listener that
 * triggers logout on 401/403 from the API client.
 */
interface AuthState {
  idToken: string | null;
  user: GoogleClaims | null;
  isAuthenticated: boolean;
  login: (idToken: string) => void;
  /** Sign in with an opaque static/dev admin token (no claims, no expiry). */
  loginWithAdminToken: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function loadInitial(): { token: string | null; user: GoogleClaims | null } {
  // A static/dev admin token (from the "token" login method) is opaque — it has no
  // claims and no expiry. It is persisted in localStorage and simply restores the
  // session on reload. Check it FIRST: it must never be run through the Google-JWT
  // decode path below, which would treat the undecodable token as expired and wipe it.
  const devToken = getDevAdminToken();
  if (devToken) return { token: devToken, user: null };

  // Otherwise a Google ID token (JWT): decode it and honour its expiry.
  const token = getToken();
  if (!token) return { token: null, user: null };
  const user = decodeGoogleToken(token);
  if (!user || isExpired(user)) {
    clearToken();
    return { token: null, user: null };
  }
  return { token, user };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(loadInitial);

  const logout = useCallback(() => {
    clearToken();
    setState({ token: null, user: null });
  }, []);

  const login = useCallback((idToken: string) => {
    setToken(idToken);
    setState({ token: idToken, user: decodeGoogleToken(idToken) });
  }, []);

  const loginWithAdminToken = useCallback((token: string) => {
    setDevAdminToken(token);
    setState({ token, user: null });
  }, []);

  // 401/403 from the API client -> drop the rejected credential and log out
  // (also clears localStorage so a reload does not "restore" the bad token).
  useEffect(() => {
    setAuthErrorListener(() => {
      clearToken();
      setState({ token: null, user: null });
    });
    return () => setAuthErrorListener(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      idToken: state.token,
      user: state.user,
      isAuthenticated: Boolean(state.token),
      login,
      loginWithAdminToken,
      logout,
    }),
    [state, login, loginWithAdminToken, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider.');
  return ctx;
}
