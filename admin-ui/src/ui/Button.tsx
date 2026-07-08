/**
 * ui/Button — button adapter (with an optional loading state).
 * Internally MUI Button + CircularProgress; the props are library-agnostic.
 */
import MuiButton from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import type { ButtonProps as MuiButtonProps } from '@mui/material/Button';
import type { ElementType } from 'react';

// `component`/`to` allow use as a router link (react-router). MUI Button is
// polymorphic; we simply pass these props through at the adapter boundary.
export interface ButtonProps extends MuiButtonProps {
  loading?: boolean;
  component?: ElementType;
  to?: string;
}

export function Button({ loading = false, disabled, children, startIcon, ...rest }: ButtonProps) {
  return (
    <MuiButton
      variant="contained"
      disabled={disabled || loading}
      startIcon={loading ? <CircularProgress size={16} color="inherit" /> : startIcon}
      {...(rest as MuiButtonProps)}
    >
      {children}
    </MuiButton>
  );
}
