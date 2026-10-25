import { createTheme } from '@mui/material/styles';
import type { LabelColour } from '../lib/api';
import { COLOR_SCHEME_ATTRIBUTE } from './themeKeys';

/** The palette colours a labels file can name, as `labelColour` in the API. */
export const LABEL_COLOURS = [
  'red',
  'amber',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'grey',
] as const satisfies readonly LabelColour[];

/** The colour of a stored label key that is no longer configured. */
export const UNCONFIGURED_LABEL_COLOUR: LabelColour = 'grey';

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
/** One colour per label colour: the row fill (`label`) or its decorative stripe. */
type LabelColours = Record<LabelColour, string>;

// TIM's own palette entries, emitted as `--mui-palette-<entry>-<key>`; `theme.vars` is always set.
declare module '@mui/material/styles' {
  interface CssThemeVariables {
    enabled: true;
  }
  interface Palette {
    editor: EditorColours;
    grid: GridColours;
    label: LabelColours;
    labelStripe: LabelColours;
  }
  interface PaletteOptions {
    editor?: EditorColours;
    grid?: GridColours;
    label?: LabelColours;
    labelStripe?: LabelColours;
  }
}

/**
 * The only place colours are defined in `web/src`: one palette, light and dark.
 *
 * One attribute, AG Grid's `data-ag-theme-mode`, selects the scheme for MUI, AG Grid and TIM's CSS.
 * `public/theme-init.js` and `CodeEditor` use the same key and attribute.
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
        label: {
          red: '#fecaca',
          amber: '#fde68a',
          green: '#bbf7d0',
          teal: '#99f6e4',
          blue: '#bfdbfe',
          purple: '#e9d5ff',
          pink: '#fbcfe8',
          grey: '#e5e7eb',
        },
        labelStripe: {
          red: '#dc2626',
          amber: '#d97706',
          green: '#16a34a',
          teal: '#0d9488',
          blue: '#2563eb',
          purple: '#9333ea',
          pink: '#db2777',
          grey: '#6b7280',
        },
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
        label: {
          red: '#7f1d1d',
          amber: '#713f12',
          green: '#14532d',
          teal: '#134e4a',
          blue: '#1e3a8a',
          purple: '#581c87',
          pink: '#831843',
          grey: '#374151',
        },
        labelStripe: {
          red: '#f87171',
          amber: '#fbbf24',
          green: '#4ade80',
          teal: '#2dd4bf',
          blue: '#60a5fa',
          purple: '#c084fc',
          pink: '#f472b6',
          grey: '#9ca3af',
        },
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
