import type * as Monaco from 'monaco-editor';

/**
 * Legacy options (KustoQueryResult.vue:176-187) except `suggest.enabled:false`: suggestions stay on
 * (Q-017, assumed).
 */
export const DEFAULT_EDITOR_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  tabSize: 2,
  minimap: { enabled: false },
  lineNumbers: 'on',
  automaticLayout: true,
  scrollBeyondLastLine: false,
};
