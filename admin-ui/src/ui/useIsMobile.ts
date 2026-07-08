/**
 * ui/useIsMobile — central responsive breakpoint hook. Returns true when the
 * viewport is at/below the given breakpoint. Used to switch data grids to card
 * lists and dialogs to full screen on phones/tablets. Kept in the ui layer so
 * the breakpoint policy lives in one place.
 */
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

export function useIsMobile(breakpoint: 'sm' | 'md' = 'md'): boolean {
  const theme = useTheme();
  // noSsr keeps the first render deterministic (matters for tests + no flash).
  return useMediaQuery(theme.breakpoints.down(breakpoint), { noSsr: true });
}
