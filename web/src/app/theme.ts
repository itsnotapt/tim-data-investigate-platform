import { createTheme } from '@mui/material/styles';
import { COLOR_SCHEME_ATTRIBUTE } from './themeKeys';

/** Code editor frame (dotted border) and background. */
interface EditorColours {
  border: string;
  background: string;
}
/** Results grid header / chrome and odd-row fill. */
interface GridColours {
  header: string;
  oddRow: string;
}
/** One colour per determination: the row fill (`determination`) or its decorative stripe. */
interface DeterminationColours {
  malicious: string;
  suspicious: string;
  benign: string;
}

// TIM's own palette entries, emitted as `--mui-palette-<entry>-<key>`; `theme.vars` is always set.
declare module '@mui/material/styles' {
  interface CssThemeVariables {
    enabled: true;
  }
  interface Palette {
    editor: EditorColours;
    grid: GridColours;
    determination: DeterminationColours;
    stripe: DeterminationColours;
  }
  interface PaletteOptions {
    editor?: EditorColours;
    grid?: GridColours;
    determination?: DeterminationColours;
    stripe?: DeterminationColours;
  }
}

/**
 * The only place colours are defined in `web/src`: one palette with a light and a dark scheme.
 * Components read colours through palette tokens (`sx`, `theme.vars.*`), never literals.
 *
 * `colorSchemeSelector` uses AG Grid's attribute name on purpose: MUI writes
 * `data-ag-theme-mode="light|dark"` on `<html>`, and AG Grid's `themeBalham` reads that same
 * attribute, so one attribute drives MUI, AG Grid and TIM's CSS. `public/theme-init.js` sets the
 * same attribute from the same `tim-theme-mode` key before the bundle runs; keep them in step.
 */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: COLOR_SCHEME_ATTRIBUTE },
  colorSchemes: {
    light: {
      palette: {
        contrastThreshold: 4.5,
        primary: { main: '#1976d2' },
        background: { default: '#ffffff', paper: '#ffffff' },
        text: { primary: '#212121', secondary: '#616161' },
        divider: '#e0e0e0',
        editor: { border: '#8a8a8a', background: '#ffffff' },
        grid: { header: '#f5f7f7', oddRow: '#fcfdfe' },
        determination: { malicious: '#fecaca', suspicious: '#fde68a', benign: '#bbf7d0' },
        stripe: { malicious: '#dc2626', suspicious: '#d97706', benign: '#16a34a' },
      },
    },
    dark: {
      palette: {
        contrastThreshold: 4.5,
        primary: { main: '#90caf9' },
        background: { default: '#121212', paper: '#1e1e1e' },
        text: { primary: '#e0e0e0', secondary: '#a0a0a0' },
        divider: '#333333',
        editor: { border: '#6e6e6e', background: '#1e1e1e' },
        grid: { header: '#262626', oddRow: '#232323' },
        determination: { malicious: '#7f1d1d', suspicious: '#713f12', benign: '#14532d' },
        stripe: { malicious: '#f87171', suspicious: '#fbbf24', benign: '#4ade80' },
      },
    },
  },
  typography: { fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif' },
  components: {
    // Flat dense toolbar on the paper colour with a 1px hairline.
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: theme.vars.palette.background.paper,
          borderBottom: `1px solid ${theme.vars.palette.divider}`,
        }),
      },
    },
    MuiToolbar: { defaultProps: { variant: 'dense' } },
  },
});
