/**
 * ui/Dialog — modal adapter.
 * Internally MUI Dialog; the props are library-agnostic.
 */
import MuiDialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import type { ReactNode } from 'react';
import { useIsMobile } from './useIsMobile';

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg';
}

export function Dialog({ open, title, onClose, actions, children, maxWidth = 'sm' }: DialogProps) {
  // Below `sm` the dialog goes full screen so forms are usable on phones.
  const fullScreen = useIsMobile('sm');
  return (
    <MuiDialog open={open} onClose={onClose} maxWidth={maxWidth} fullWidth fullScreen={fullScreen}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>{children}</DialogContent>
      {actions && <DialogActions sx={{ px: 3, py: 2 }}>{actions}</DialogActions>}
    </MuiDialog>
  );
}
