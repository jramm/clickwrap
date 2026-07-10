import { ThemeProvider } from '@mui/material/styles';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { I18nProvider } from '../i18n';
import { theme } from '../theme/theme';
import { ToastProvider } from '../ui';

/**
 * Test render helper: wraps the UI under test with all providers and a fresh
 * QueryClient (no retries, no cache shared between tests). The i18n default
 * locale is English, so tests assert English strings.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/' }: { route?: string } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nProvider>
        <GoogleOAuthProvider clientId="test-client-id">
          <QueryClientProvider client={queryClient}>
            <ThemeProvider theme={theme}>
              <ToastProvider>
                <MemoryRouter initialEntries={[route]}>
                  <AuthProvider>{children}</AuthProvider>
                </MemoryRouter>
              </ToastProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </GoogleOAuthProvider>
      </I18nProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}
