import { loader } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { theme } from '../../app/theme';
import { buildTimTheme, type TimThemeName } from './timThemes';

export type MonacoApi = typeof Monaco;
export type EditorLanguage = 'kusto' | 'yaml' | 'json' | 'plaintext';

let corePromise: Promise<MonacoApi> | null = null;
let kustoPromise: Promise<void> | null = null;

type KustoRules = Record<'light' | 'dark', Monaco.editor.ITokenThemeRule[]>;

/**
 * Defines `tim-light` and `tim-dark` from the palette in `theme.ts`. Redefining the active theme
 * restyles open editors in place. `CodeEditor` picks the name.
 */
function defineTimThemes(monaco: MonacoApi, kustoRules?: KustoRules): void {
  const schemes: [TimThemeName, 'light' | 'dark'][] = [
    ['tim-light', 'light'],
    ['tim-dark', 'dark'],
  ];
  for (const [name, scheme] of schemes) {
    const palette = theme.colorSchemes[scheme]!.palette;
    monaco.editor.defineTheme(name, buildTimTheme(palette, kustoRules?.[scheme]));
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
 * worker environment and points @monaco-editor/react at it. Cached; safe to call repeatedly.
 */
export function loadMonaco(): Promise<MonacoApi> {
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
    // Defined here, not only with Kusto: an unknown theme name falls back silently to light `vs`.
    defineTimThemes(api);
    return api;
  })().catch((e: unknown) => {
    corePromise = null;
    throw e;
  });
  return corePromise;
}

/** Loads monaco plus the Kusto language service (registers language `kusto`). */
export async function loadMonacoKusto(): Promise<MonacoApi> {
  const monaco = await loadMonaco();
  kustoPromise ??= import('@kusto/monaco-kusto/release/esm/monaco.contribution')
    .then(loadKustoRules)
    .then((rules) => defineTimThemes(monaco, rules));
  try {
    await kustoPromise;
  } catch (e) {
    kustoPromise = null;
    throw e;
  }
  return monaco;
}
