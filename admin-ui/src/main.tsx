import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { APP_NAME } from './config';
import { I18nProvider } from './i18n';
import { theme } from './theme/theme';
import { ToastProvider } from './ui';

document.title = APP_NAME;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root not found.');

// Router base path = Vite's `base` (BASE_URL). '/' by default; the "combined" Docker image
// builds with VITE_BASE=/ui/ so the SPA is served under /ui alongside the backend at root.
const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <ToastProvider>
            <BrowserRouter basename={routerBasename}>
              <AuthProvider>
                <App />
              </AuthProvider>
            </BrowserRouter>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
