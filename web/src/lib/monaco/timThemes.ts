import { decomposeColor, type Palette, type SupportedColorScheme } from '@mui/material/styles';
import type * as Monaco from 'monaco-editor';

/** Monaco theme name per colour scheme: `loader.ts` defines them, `CodeEditor` picks one. */
export const TIM_THEME_NAMES = { light: 'tim-light', dark: 'tim-dark' } as const satisfies Record<
  SupportedColorScheme,
  string
>;

/** The palette of each colour scheme, from `theme.colorSchemes`. */
export type TimPalettes = Record<SupportedColorScheme, Palette>;

type ThemeData = Monaco.editor.IStandaloneThemeData;
type TokenRule = Monaco.editor.ITokenThemeRule;

/** Share of `primary.main` in the selection and suggest-selection fills, over the editor background. */
const SELECTION_WEIGHT = 0.3;

const channelHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/**
 * `colour` mixed over `background`, as 6-digit hex. `weight` is the share of `colour`.
 */
function mixToHex(colour: string, background: string, weight = 1): string {
  const fg = decomposeColor(colour);
  const bg = decomposeColor(background);
  if (fg.type !== 'rgb' && fg.type !== 'rgba') throw new Error(`Unsupported colour: ${colour}`);
  const share = weight * (fg.values[3] ?? 1);
  const channels = [0, 1, 2].map((i) => fg.values[i]! * share + bg.values[i]! * (1 - share));
  return `#${channels.map(channelHex).join('')}`;
}

/** Token rules whose colour is the editor text colour rather than a syntax colour. */
const PLAIN_TOKENS = new Set(['', 'plainText']);

/**
 * Monaco theme data for one colour scheme of the TIM palette: `tim-light` on `vs` or `tim-dark` on
 * `vs-dark`. `kustoRules` are monaco-kusto's token rules for the same scheme; they are kept, with
 * plain text in `text.primary`.
 */
export function buildTimTheme(palette: Palette, kustoRules: TokenRule[] = []): ThemeData {
  const background = palette.editor.background;
  const hex = (colour: string, weight?: number) => mixToHex(colour, background, weight);
  const text = hex(palette.text.primary);
  const secondary = hex(palette.text.secondary);
  const border = hex(palette.editor.border);
  const paper = hex(palette.background.paper);
  const primary = hex(palette.primary.main);
  const selection = hex(palette.primary.main, SELECTION_WEIGHT);
  return {
    base: palette.mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: kustoRules.map((rule) =>
      PLAIN_TOKENS.has(rule.token) ? { ...rule, foreground: text } : rule,
    ),
    colors: {
      'editor.background': hex(background),
      'editor.foreground': text,
      'editorLineNumber.foreground': secondary,
      'editorLineNumber.activeForeground': text,
      'editor.lineHighlightBackground': hex(palette.grid.oddRow),
      'editor.selectionBackground': selection,
      'editorGutter.background': hex(background),
      'editorWidget.background': paper,
      'editorWidget.foreground': text,
      'editorWidget.border': border,
      'editorSuggestWidget.background': paper,
      'editorSuggestWidget.foreground': text,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.selectedBackground': selection,
      'editorSuggestWidget.highlightForeground': primary,
      'editorHoverWidget.background': paper,
      'editorHoverWidget.foreground': text,
      'editorHoverWidget.border': border,
      focusBorder: primary,
    },
  };
}
