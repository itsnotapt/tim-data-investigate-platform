import { loader } from '@monaco-editor/react';
import type { SupportedColorScheme } from '@mui/material/styles';
import type * as Monaco from 'monaco-editor';
import { buildTimTheme, TIM_THEME_NAMES, type TimPalettes } from './timThemes';

export type MonacoApi = typeof Monaco;
export type EditorLanguage = 'kusto' | 'yaml' | 'json' | 'plaintext';

let corePromise: Promise<MonacoApi> | null = null;
let kustoPromise: Promise<void> | null = null;

type KustoRules = Record<SupportedColorScheme, Monaco.editor.ITokenThemeRule[]>;

/** Defines `tim-light` and `tim-dark`; redefining the active theme restyles open editors. */
function defineTimThemes(monaco: MonacoApi, palettes: TimPalettes, kustoRules?: KustoRules): void {
  for (const scheme of ['light', 'dark'] as const) {
    monaco.editor.defineTheme(
      TIM_THEME_NAMES[scheme],
      buildTimTheme(palettes[scheme], kustoRules?.[scheme]),
    );
  }
}

/** monaco-kusto's `kusto-light` / `kusto-dark` token rules. */
async function loadKustoRules(): Promise<KustoRules> {
  // Deep import: `themes` isn't exported from monaco-kusto's public entry (works in 15.0.1).
  const { themes, ThemeName } =
    await import('@kusto/monaco-kusto/release/esm/syntaxHighlighting/themes');
  const rulesOf = (name: (typeof themes)[number]['name']) =>
    themes.find((t) => t.name === name)?.data.rules ?? [];
  return { light: rulesOf(ThemeName.light), dark: rulesOf(ThemeName.dark) };
}

/**
 * Loads the locally bundled monaco-editor (no CDN) with the yaml and json languages, installs the
 * worker environment, points @monaco-editor/react at it and defines the TIM themes from
 * `palettes`. Cached; safe to call repeatedly.
 */
export function loadMonaco(palettes: TimPalettes): Promise<MonacoApi> {
  corePromise ??= (async () => {
    const [{ installMonacoEnvironment }] = await Promise.all([
      import('./environment'),
      // Full editor features without bundling every basic language.
      import('monaco-editor/esm/vs/editor/edcore.main'),
      import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'),
      import('monaco-editor/esm/vs/language/json/monaco.contribution'),
    ]);
    installMonacoEnvironment();
    // editor.api is one shared module instance, also used by monaco-kusto.
    const api: MonacoApi = await import('monaco-editor/esm/vs/editor/editor.api');
    loader.config({ monaco: api });
    // An unknown theme name falls back silently to light `vs`.
    defineTimThemes(api, palettes);
    return api;
  })().catch((e: unknown) => {
    corePromise = null;
    throw e;
  });
  return corePromise;
}

/**
 * Loads monaco plus the Kusto language service (registers language `kusto`) and redefines the TIM
 * themes with its token rules.
 */
export async function loadMonacoKusto(palettes: TimPalettes): Promise<MonacoApi> {
  const monaco = await loadMonaco(palettes);
  kustoPromise ??= import('@kusto/monaco-kusto/release/esm/monaco.contribution')
    .then(loadKustoRules)
    .then((rules) => defineTimThemes(monaco, palettes, rules));
  try {
    await kustoPromise;
  } catch (e) {
    kustoPromise = null;
    throw e;
  }
  return monaco;
}
