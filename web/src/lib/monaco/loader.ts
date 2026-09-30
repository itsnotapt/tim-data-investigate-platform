import { loader } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';

export type MonacoApi = typeof Monaco;
export type EditorLanguage = 'kusto' | 'yaml' | 'json' | 'plaintext';

let corePromise: Promise<MonacoApi> | null = null;
let kustoPromise: Promise<void> | null = null;

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
  kustoPromise ??= import('@kusto/monaco-kusto/release/esm/monaco.contribution').then(
    () => undefined,
  );
  try {
    await kustoPromise;
  } catch (e) {
    kustoPromise = null;
    throw e;
  }
  return monaco;
}

/** Test hook. */
export function resetMonacoLoaderForTests(): void {
  corePromise = null;
  kustoPromise = null;
}
