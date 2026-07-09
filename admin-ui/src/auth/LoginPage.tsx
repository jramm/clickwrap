import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { APP_NAME } from '../config';
import { useTranslation } from '../i18n';
import { gradients } from '../theme/tokens';
import { Button, TextField, useToast } from '../ui';
import { useAuth } from './AuthContext';
import { fetchAuthMethods } from './authMethods';
import type { AuthMethod } from './authMethods';

/**
 * Login screen. Discovers the available admin login methods from the
 * unauthenticated `GET /admin/auth/methods` and renders one option per method
 * (Google SSO / dev token / OIDC redirect). If the endpoint is unavailable
 * (older backend), it falls back to the legacy Google flow using the deprecated
 * VITE_GOOGLE_CLIENT_ID and logs a warning.
 */
export function LoginPage() {
  const { isAuthenticated } = useAuth();
  const { t } = useTranslation();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['auth-methods'],
    queryFn: ({ signal }) => fetchAuthMethods(signal),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (isError) {
      // eslint-disable-next-line no-console
      console.warn(
        '[login] GET /admin/auth/methods unavailable — falling back to the legacy Google flow (VITE_GOOGLE_CLIENT_ID).',
      );
    }
  }, [isError]);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const legacyClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
  const fallbackMethods: AuthMethod[] = [
    { key: 'google', flow: 'google', label: t('login.google'), params: { clientId: legacyClientId } },
  ];
  const methods = data ?? (isError ? fallbackMethods : []);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: gradients.heroBand,
        p: 2,
      }}
    >
      <Paper elevation={3} sx={{ p: { xs: 3, sm: 5 }, maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <Typography variant="h3" component="h1" sx={{ mb: 1 }}>
          {APP_NAME}
        </Typography>
        <Typography variant="h5" color="text.secondary" sx={{ mb: 1 }}>
          {t('login.subtitle')}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
          {t('login.prompt')}
        </Typography>

        {isLoading ? (
          <Typography color="text.secondary">{t('common.loading')}</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {methods.map((method, index) => (
              <Box key={method.key} data-testid={`login-method-${method.flow}`}>
                {index > 0 && <Divider sx={{ mb: 2 }} />}
                <LoginMethod method={method} />
              </Box>
            ))}
            {methods.length === 0 && (
              <Typography color="error">{t('login.noMethods')}</Typography>
            )}
          </Box>
        )}
      </Paper>
    </Box>
  );
}

function LoginMethod({ method }: { method: AuthMethod }) {
  const { t, language } = useTranslation();
  const { login } = useAuth();
  const toast = useToast();

  if (method.flow === 'google') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <GoogleOAuthProvider clientId={method.params.clientId ?? ''}>
          <GoogleLogin
            onSuccess={(response) => {
              if (response.credential) {
                login(response.credential);
              } else {
                toast.error(t('login.noToken'));
              }
            }}
            onError={() => toast.error(t('login.failed'))}
            useOneTap={false}
            locale={language}
          />
        </GoogleOAuthProvider>
      </Box>
    );
  }

  if (method.flow === 'oidc-redirect') {
    return (
      <Button
        component="a"
        href={method.params.authorizeUrl ?? '#'}
        disabled={!method.params.authorizeUrl}
        fullWidth
        sx={{ minHeight: 44 }}
      >
        {method.label}
      </Button>
    );
  }

  return <TokenMethod label={method.label} />;
}

function TokenMethod({ label }: { label: string }) {
  const { t } = useTranslation();
  const { loginWithAdminToken } = useAuth();
  const [token, setToken] = useState('');

  const submit = () => {
    const value = token.trim();
    if (!value) return;
    // Persist as the dev admin token (sent as x-admin-token) and mark the session
    // authenticated; it is restored from localStorage on reload.
    loginWithAdminToken(value);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <TextField
        label={t('login.tokenLabel')}
        type="password"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
      />
      <Button onClick={submit} disabled={!token.trim()} fullWidth sx={{ minHeight: 44 }}>
        {t('login.tokenSubmit')}
      </Button>
    </Box>
  );
}
