import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

/**
 * Route guard: without a token, back to login. The API client discards the token
 * on 401/403 and triggers logout, which makes this guard kick in again.
 */
export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
