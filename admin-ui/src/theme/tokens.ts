/**
 * Design tokens — the single source of truth for the visual language.
 *
 * These are neutral, brand-agnostic defaults (indigo primary, teal secondary).
 * To re-brand the app, adjust the ramps below (and, if desired, the app name in
 * `src/config.ts`). `src/theme/theme.ts` maps these tokens onto MUI's
 * semantic palette; the `src/ui/` adapter layer consumes only the resulting
 * theme, so a re-brand never touches page or component code.
 */

// --- Color ramps ----------------------------------------------------------
export const indigo = { 50: '#EEF0FB', 500: '#4F58C4', 700: '#3A429B', 900: '#272C6B' } as const;
export const teal = { 50: '#E4F6F4', 500: '#0FA697', 700: '#0B7E73', 900: '#08514A' } as const;
export const emerald = { 50: '#E6F4EF', 500: '#0B8A63', 700: '#08624A', 900: '#075842' } as const;
export const amber = { 50: '#FFF4E1', 500: '#E08600', 700: '#B36A00', 900: '#7A4700' } as const;
export const red = { 50: '#FCE8EA', 500: '#D32F45', 700: '#A81F33', 900: '#791523' } as const;
export const violet = { 50: '#F1EEFB', 500: '#6C4BD1', 700: '#553AA6', 900: '#3E2B79' } as const;

export const neutral = {
  0: '#FFFFFF',
  50: '#FBFCFD',
  100: '#F4F6F8',
  200: '#E7EBF0',
  300: '#D3DAE2',
  400: '#AAB4C0',
  500: '#8A96A4',
  600: '#647180',
  700: '#48535F',
  800: '#2A333D',
  900: '#111820',
} as const;

// --- Typography -----------------------------------------------------------
export const fontFamily = ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'].join(',');
export const fontWeight = { regular: 400, medium: 500, semibold: 600 } as const;
export const fontSize = {
  micro: '0.625rem',
  extraSmall: '0.75rem',
  small: '0.875rem',
  regular: '1rem',
  h5: '1.125rem',
  h4: '1.25rem',
  h3: '1.4375rem',
  h2: '1.625rem',
  h1: '2.25rem',
} as const;
export const lineHeight = { tight: 1.3, heading: 1.35, snug: 1.4, normal: 1.5 } as const;

// --- Radius ---------------------------------------------------------------
export const radii = { xs: 4, sm: 8, md: 10, lg: 16, xl: 20, pill: 999 } as const;

// --- Elevation ------------------------------------------------------------
export const elevation = {
  sm: '0 1px 3px rgba(20,30,60,.05), 0 4px 18px rgba(20,30,60,.06)',
  md: '0 4px 12px rgba(20,30,60,.08), 0 10px 28px rgba(20,30,60,.07)',
  lg: '0 12px 28px rgba(20,30,60,.12), 0 24px 56px rgba(20,30,60,.10)',
} as const;

// --- Gradients ------------------------------------------------------------
export const gradients = {
  heroBand: `linear-gradient(135deg, ${indigo[900]} 0%, ${indigo[700]} 100%)`,
  accentStrip: `linear-gradient(90deg, ${indigo[500]} 0%, ${teal[500]} 50%, ${amber[500]} 100%)`,
} as const;
