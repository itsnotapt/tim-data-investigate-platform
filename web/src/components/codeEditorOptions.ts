import type * as Monaco from 'monaco-editor';

/** Default Monaco options; suggestions stay enabled. */
export const DEFAULT_EDITOR_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  tabSize: 2,
  minimap: { enabled: false },
  lineNumbers: 'on',
  automaticLayout: true,
  scrollBeyondLastLine: false,
};
