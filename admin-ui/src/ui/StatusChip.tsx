/**
 * ui/StatusChip — colored status chip for the acceptance states.
 * Internally an MUI Chip. Labels come from the i18n `status.*` namespace.
 *
 * Color convention: ACCEPTED green, NOTIFIED/PENDING_NOTIFICATION amber,
 * EXPIRED_BLOCKING red, OBJECTED violet, SUPERSEDED grey.
 */
import Chip from '@mui/material/Chip';
import type { CellState } from '../api/hooks';
import { useTranslation } from '../i18n';

type ChipColor = 'success' | 'warning' | 'error' | 'info' | 'default';

const COLORS: Record<CellState, ChipColor> = {
  ACCEPTED: 'success',
  NOTIFIED: 'warning',
  PENDING_NOTIFICATION: 'warning',
  EXPIRED_BLOCKING: 'error',
  OBJECTED: 'info', // info = violet in the theme
  SUPERSEDED: 'default',
};

export interface StatusChipProps {
  state: CellState;
  size?: 'small' | 'medium';
}

export function StatusChip({ state, size = 'small' }: StatusChipProps) {
  const { t } = useTranslation();
  const color = COLORS[state] ?? 'default';
  return <Chip label={t(`status.${state}`)} color={color} size={size} variant="filled" />;
}
