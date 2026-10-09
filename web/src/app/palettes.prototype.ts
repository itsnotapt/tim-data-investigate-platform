// PROTOTYPE (wayfinder #40): three palette directions, each with a light and a dark scheme,
// switchable via ?variant=A|B|C on /#/prototype/palettes. Every colour the app draws comes from
// here: MUI shell, AG Grid surfaces and determination rows, Monaco tim-light / tim-dark, the
// editor border that replaces `darkgrey`. Throwaway: lives on branch prototype/palettes only.
import { createTheme } from '@mui/material/styles';
import { themeBalham } from 'ag-grid-community';
import { create } from 'zustand';

export interface SchemePalette {
  primary: string;
  background: string;
  paper: string;
  text: string;
  textSecondary: string;
  /** Hairlines: AppBar bottom, grid borders. Decorative, no contrast minimum. */
  divider: string;
  /** Editor and input borders: meaningful UI, 3:1 against the surface. */
  border: string;
  gridHeader: string;
  gridOddRow: string;
  editor: string;
  determination: { malicious: string; suspicious: string; benign: string };
  /** Left edge stripe on determination rows; `transparent` = no stripe. */
  stripe: { malicious: string; suspicious: string; benign: string };
}

export interface PaletteVariant {
  key: 'A' | 'B' | 'C';
  name: string;
  light: SchemePalette;
  dark: SchemePalette;
}

const noStripe = { malicious: 'transparent', suspicious: 'transparent', benign: 'transparent' };

export const PALETTES: Record<PaletteVariant['key'], PaletteVariant> = {
  // A (chosen): today's look kept (MUI blue, plain white) plus a Material-style dark scheme;
  // determination fills taken from C (no stripe).
  A: {
    key: 'A',
    name: 'Material neutral',
    light: {
      primary: '#1976d2',
      background: '#ffffff',
      paper: '#ffffff',
      text: '#212121',
      textSecondary: '#616161',
      divider: '#e0e0e0',
      border: '#8a8a8a',
      gridHeader: '#f5f7f7',
      gridOddRow: '#fcfdfe',
      editor: '#ffffff',
      determination: { malicious: '#fecaca', suspicious: '#fde68a', benign: '#bbf7d0' },
      stripe: noStripe,
    },
    dark: {
      primary: '#90caf9',
      background: '#121212',
      paper: '#1e1e1e',
      text: '#e0e0e0',
      textSecondary: '#a0a0a0',
      divider: '#333333',
      border: '#6e6e6e',
      gridHeader: '#262626',
      gridOddRow: '#232323',
      editor: '#1e1e1e',
      determination: { malicious: '#7f1d1d', suspicious: '#713f12', benign: '#14532d' },
      stripe: noStripe,
    },
  },
  // B: Azure Data Explorer / Fluent look: grey page with white panels (layered surfaces), Fluent
  // brand blue, subtle Fluent status tints for the determination rows.
  B: {
    key: 'B',
    name: 'Fluent / ADX layered',
    light: {
      primary: '#0f6cbd',
      background: '#f0f0f0',
      paper: '#ffffff',
      text: '#242424',
      textSecondary: '#616161',
      divider: '#e0e0e0',
      border: '#858585',
      gridHeader: '#fafafa',
      gridOddRow: '#fafafa',
      editor: '#ffffff',
      determination: { malicious: '#fde7e9', suspicious: '#fff4ce', benign: '#dff6dd' },
      stripe: noStripe,
    },
    dark: {
      primary: '#479ef5',
      background: '#1f1f1f',
      paper: '#292929',
      text: '#ffffff',
      textSecondary: '#adadad',
      divider: '#3d3d3d',
      border: '#757575',
      gridHeader: '#2e2e2e',
      gridOddRow: '#2c2c2c',
      editor: '#1f1f1f',
      determination: { malicious: '#442726', suspicious: '#463100', benign: '#052505' },
      stripe: noStripe,
    },
  },
  // C: cool slate surfaces, indigo primary, stronger determination fills plus a saturated left
  // stripe, so the row colour is carried by more than a pale tint.
  C: {
    key: 'C',
    name: 'Slate + stripes',
    light: {
      primary: '#4f46e5',
      background: '#f8fafc',
      paper: '#ffffff',
      text: '#0f172a',
      textSecondary: '#475569',
      divider: '#e2e8f0',
      border: '#64748b',
      gridHeader: '#f1f5f9',
      gridOddRow: '#f8fafc',
      editor: '#ffffff',
      determination: { malicious: '#fecaca', suspicious: '#fde68a', benign: '#bbf7d0' },
      stripe: { malicious: '#dc2626', suspicious: '#d97706', benign: '#16a34a' },
    },
    dark: {
      primary: '#818cf8',
      background: '#0f172a',
      paper: '#1e293b',
      text: '#e2e8f0',
      textSecondary: '#94a3b8',
      divider: '#334155',
      border: '#64748b',
      gridHeader: '#273449',
      gridOddRow: '#223047',
      editor: '#0f172a',
      determination: { malicious: '#7f1d1d', suspicious: '#713f12', benign: '#14532d' },
      stripe: { malicious: '#f87171', suspicious: '#fbbf24', benign: '#4ade80' },
    },
  },
};

export const usePaletteStore = create<{
  variant: PaletteVariant['key'];
  setVariant: (v: PaletteVariant['key']) => void;
}>((set) => ({ variant: 'A', setVariant: (variant) => set({ variant }) }));

declare module '@mui/material/styles' {
  interface Palette {
    determination: SchemePalette['determination'];
    stripe: SchemePalette['stripe'];
    tim: { border: string; gridHeader: string; gridOddRow: string; editor: string };
  }
  interface PaletteOptions {
    determination?: SchemePalette['determination'];
    stripe?: SchemePalette['stripe'];
    tim?: { border: string; gridHeader: string; gridOddRow: string; editor: string };
  }
}

const schemeOptions = (p: SchemePalette) => ({
  palette: {
    primary: { main: p.primary },
    background: { default: p.background, paper: p.paper },
    text: { primary: p.text, secondary: p.textSecondary },
    divider: p.divider,
    // AA for button labels on primary (MUI's default threshold of 3 can pick a failing one).
    contrastThreshold: 4.5,
    determination: p.determination,
    stripe: p.stripe,
    tim: { border: p.border, gridHeader: p.gridHeader, gridOddRow: p.gridOddRow, editor: p.editor },
  },
});

export function buildTheme(v: PaletteVariant) {
  return createTheme({
    // One attribute on <html> drives MUI, AG Grid's own light/dark params and grid.css.
    cssVariables: { colorSchemeSelector: 'data-ag-theme-mode' },
    colorSchemes: { light: schemeOptions(v.light), dark: schemeOptions(v.dark) },
    typography: { fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif' },
    components: {
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
}

/** AG Grid surfaces read the MUI variables, so they follow both the scheme and the variant. */
export const gridTheme = themeBalham.withParams({
  backgroundColor: 'var(--mui-palette-background-paper)',
  foregroundColor: 'var(--mui-palette-text-primary)',
  textColor: 'var(--mui-palette-text-primary)',
  borderColor: 'var(--mui-palette-divider)',
  accentColor: 'var(--mui-palette-primary-main)',
  headerBackgroundColor: 'var(--mui-palette-tim-gridHeader)',
  oddRowBackgroundColor: 'var(--mui-palette-tim-gridOddRow)',
  chromeBackgroundColor: 'var(--mui-palette-tim-gridHeader)',
});

// --- WCAG contrast -------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (l: number) => {
  const c = Math.min(1, Math.max(0, l));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
};
const luminance = (hex: string) => {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

export interface Check {
  label: string;
  fg: string;
  bg: string;
  /** null: reported, not required. */
  min: number | null;
}

export function checksFor(p: SchemePalette, buttonText: string): Check[] {
  const d = p.determination;
  return [
    { label: 'Text on page', fg: p.text, bg: p.background, min: 4.5 },
    { label: 'Text on paper / grid', fg: p.text, bg: p.paper, min: 4.5 },
    { label: 'Secondary text on paper', fg: p.textSecondary, bg: p.paper, min: 4.5 },
    { label: 'Text on odd grid row', fg: p.text, bg: p.gridOddRow, min: 4.5 },
    { label: 'Text on grid header', fg: p.text, bg: p.gridHeader, min: 4.5 },
    { label: 'Primary (link) on paper', fg: p.primary, bg: p.paper, min: 4.5 },
    { label: 'Primary (link) on page', fg: p.primary, bg: p.background, min: 4.5 },
    { label: 'Button label on primary', fg: buttonText, bg: p.primary, min: 4.5 },
    { label: 'Editor / input border on paper', fg: p.border, bg: p.paper, min: 3 },
    { label: 'Editor border on page', fg: p.border, bg: p.background, min: 3 },
    { label: 'Text on malicious row', fg: p.text, bg: d.malicious, min: 4.5 },
    { label: 'Text on suspicious row', fg: p.text, bg: d.suspicious, min: 4.5 },
    { label: 'Text on benign row', fg: p.text, bg: d.benign, min: 4.5 },
    { label: 'Malicious vs untagged row', fg: d.malicious, bg: p.paper, min: null },
    { label: 'Suspicious vs untagged row', fg: d.suspicious, bg: p.paper, min: null },
    { label: 'Benign vs untagged row', fg: d.benign, bg: p.paper, min: null },
    { label: 'Malicious vs suspicious', fg: d.malicious, bg: d.suspicious, min: null },
    { label: 'Malicious vs benign', fg: d.malicious, bg: d.benign, min: null },
    { label: 'Suspicious vs benign', fg: d.suspicious, bg: d.benign, min: null },
    { label: 'Divider on paper', fg: p.divider, bg: p.paper, min: null },
  ];
}

// --- Colour vision deficiency simulation (Machado et al. 2009, severity 1.0) ---------------

type M = [number[], number[], number[]];
export const CVD: Record<string, M | null> = {
  normal: null,
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export function simulate(hex: string, m: M | null): string {
  if (!m || hex === 'transparent') return hex;
  const lin = hexToRgb(hex).map(toLinear);
  const out = m.map((row) => fromLinear(row[0]! * lin[0]! + row[1]! * lin[1]! + row[2]! * lin[2]!));
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
