/**
 * ui/Toast — toast/snackbar adapter.
 * Internally MUI Snackbar + Alert; the useToast API is library-agnostic.
 */
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

type ToastSeverity = 'success' | 'error' | 'info' | 'warning';

interface ToastMessage {
  id: number;
  message: string;
  severity: ToastSeverity;
}

interface ToastApi {
  show: (message: string, severity?: ToastSeverity) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastMessage | null>(null);

  const show = useCallback((message: string, severity: ToastSeverity = 'info') => {
    setCurrent({ id: Date.now(), message, severity });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message: string) => show(message, 'success'),
      error: (message: string) => show(message, 'error'),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        open={current !== null}
        autoHideDuration={6000}
        onClose={() => setCurrent(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {current ? (
          <Alert
            onClose={() => setCurrent(null)}
            severity={current.severity}
            variant="filled"
            sx={{ width: '100%' }}
          >
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider.');
  return ctx;
}
