import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { decodeGoogleToken, isExpired } from './googleToken';
import type { GoogleClaims } from './googleToken';
import { clearToken, getToken, setAuthErrorListener, setToken } from './tokenStore';

/**
 * Auth state of the app. Holds the Google ID token (via tokenStore in memory +
 * localStorage) and the decoded display claims. Registers a listener that
 * triggers logout on 401/403 from the API client.
 */
interface AuthState {
  idToken: string | null;
  user: GoogleClaims | null;
  isAuthenticated: boolean;
  login: (idToken: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function loadInitial(): { token: string | null; user: GoogleClaims | null } {
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

  // 401/403 from the API client -> logout.
  useEffect(() => {
    setAuthErrorListener(() => setState({ token: null, user: null }));
    return () => setAuthErrorListener(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      idToken: state.token,
      user: state.user,
      isAuthenticated: Boolean(state.token),
      login,
      logout,
    }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider.');
  return ctx;
}
