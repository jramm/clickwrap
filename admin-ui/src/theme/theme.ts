import { createTheme } from '@mui/material/styles';
import {
  amber,
  elevation,
  emerald,
  fontFamily,
  fontSize,
  fontWeight,
  indigo,
  lineHeight,
  neutral,
  radii,
  red,
  teal,
  violet,
} from './tokens';

/**
 * MUI theme for the admin UI. Maps the design tokens (tokens.ts) onto MUI's
 * semantic palette. This is the only file that knows about MUI's theme shape;
 * to re-brand, change the tokens rather than this mapping.
 */
export const theme = createTheme({
  shape: { borderRadius: radii.sm },
  palette: {
    mode: 'light',
    primary: { main: indigo[500], light: indigo[50], dark: indigo[700], contrastText: neutral[0] },
    secondary: { main: teal[500], light: teal[50], dark: teal[700], contrastText: neutral[0] },
    success: { main: emerald[500], light: emerald[50], dark: emerald[700], contrastText: neutral[0] },
    warning: { main: amber[500], light: amber[50], dark: amber[700], contrastText: neutral[0] },
    error: { main: red[500], light: red[50], dark: red[700], contrastText: neutral[0] },
    info: { main: violet[500], light: violet[50], dark: violet[700], contrastText: neutral[0] },
    text: { primary: neutral[700], secondary: neutral[600], disabled: neutral[500] },
    divider: neutral[300],
    background: { default: neutral[50], paper: neutral[0] },
  },
  typography: {
    fontFamily,
    fontWeightRegular: fontWeight.regular,
    fontWeightMedium: fontWeight.medium,
    fontWeightBold: fontWeight.semibold,
    h1: { fontSize: fontSize.h1, fontWeight: fontWeight.semibold, lineHeight: lineHeight.tight },
    h2: { fontSize: fontSize.h2, fontWeight: fontWeight.semibold, lineHeight: lineHeight.tight },
    h3: { fontSize: fontSize.h3, fontWeight: fontWeight.semibold, lineHeight: lineHeight.tight },
    h4: { fontSize: fontSize.h4, fontWeight: fontWeight.medium, lineHeight: lineHeight.heading },
    h5: { fontSize: fontSize.h5, fontWeight: fontWeight.medium, lineHeight: lineHeight.snug },
    h6: { fontSize: fontSize.regular, fontWeight: fontWeight.semibold, lineHeight: lineHeight.snug },
    body1: { fontSize: fontSize.small, lineHeight: lineHeight.normal },
    body2: { fontSize: fontSize.extraSmall, lineHeight: lineHeight.normal },
    button: { textTransform: 'none', fontWeight: fontWeight.medium },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        elevation1: { boxShadow: elevation.sm },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: radii.sm } },
    },
    MuiCard: {
      styleOverrides: { root: { borderRadius: radii.md, boxShadow: elevation.sm } },
    },
    MuiAppBar: {
      styleOverrides: { root: { boxShadow: elevation.sm } },
    },
  },
});
