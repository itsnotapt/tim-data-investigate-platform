import { Editor, type OnMount } from '@monaco-editor/react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { DEFAULT_EDITOR_OPTIONS } from './codeEditorOptions';
import { loadMonaco, loadMonacoKusto, type EditorLanguage } from '../lib/monaco';
import { useColorScheme } from '@mui/material/styles';
import { themes as kustoThemes } from '@kusto/monaco-kusto/release/esm/syntaxHighlighting/themes';
import { PALETTES, usePaletteStore, type SchemePalette } from '../app/palettes.prototype';

// PROTOTYPE (wayfinder #40): tim-light / tim-dark generated as hex from the palette, keeping
// monaco-kusto's KQL token colours except plain text, which takes the palette text colour.
export function timMonacoTheme(
  scheme: 'light' | 'dark',
  p: SchemePalette,
): Monaco.editor.IStandaloneThemeData {
  const kusto = kustoThemes.find((t) => t.name === `kusto-${scheme}`)!.data;
  const plain = new Set(['#000000', '#DCDCDC']);
  return {
    base: scheme === 'light' ? 'vs' : 'vs-dark',
    inherit: true,
    rules: kusto.rules.map((r) =>
      r.foreground && plain.has(r.foreground) ? { ...r, foreground: p.text } : r,
    ),
    colors: {
      'editor.background': p.editor,
      'editor.foreground': p.text,
      'editorLineNumber.foreground': p.textSecondary,
      'editorLineNumber.activeForeground': p.text,
      'editor.lineHighlightBackground': p.gridOddRow,
      'editor.lineHighlightBorder': p.divider,
      'editorWidget.background': p.paper,
      'editorWidget.border': p.border,
      'editorSuggestWidget.background': p.paper,
      'editorSuggestWidget.border': p.border,
    },
  };
}

export type CodeEditorInstance = Monaco.editor.IStandaloneCodeEditor;

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: EditorLanguage;
  readOnly?: boolean;
  /** CSS height of the editor surface; default fills the parent. */
  height?: string | number;
  /** Stable model path (unique per editor when several share a page). */
  path?: string;
  ariaLabel?: string;
  options?: Monaco.editor.IStandaloneEditorConstructionOptions;
  /** Called once the editor exists (and the Kusto service is registered for `kusto`). */
  onMount?: (editor: CodeEditorInstance, monaco: typeof Monaco) => void;
}

/**
 * Monaco wrapper using the locally bundled monaco-editor (no CDN). The model and editor are
 * disposed on unmount.
 */
export function CodeEditor({
  value,
  onChange,
  language = 'plaintext',
  readOnly = false,
  height = '100%',
  path,
  ariaLabel,
  options,
  onMount,
}: CodeEditorProps) {
  const [loadedLanguage, setLoadedLanguage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<CodeEditorInstance | null>(null);
  const { colorScheme } = useColorScheme();
  const variant = usePaletteStore((st) => st.variant);
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const [monacoApi, setMonacoApi] = useState<typeof Monaco | null>(null);
  useEffect(() => {
    if (!monacoApi) return;
    monacoApi.editor.defineTheme('tim-light', timMonacoTheme('light', PALETTES[variant].light));
    monacoApi.editor.defineTheme('tim-dark', timMonacoTheme('dark', PALETTES[variant].dark));
    monacoApi.editor.setTheme(`tim-${scheme}`);
  }, [monacoApi, variant, scheme]);

  useEffect(() => {
    let cancelled = false;
    (language === 'kusto' ? loadMonacoKusto() : loadMonaco()).then(
      () => !cancelled && setLoadedLanguage(language),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [language]);

  useEffect(
    () => () => {
      const editor = editorRef.current;
      editorRef.current = null;
      if (!editor) return;
      editor.getModel()?.dispose();
      editor.dispose();
    },
    [],
  );

  const handleMount = useCallback<OnMount>(
    (editor, monaco) => {
      editorRef.current = editor;
      setMonacoApi(monaco);
      onMount?.(editor, monaco);
    },
    [onMount],
  );

  const ready = loadedLanguage === language;
  if (error) return <Alert severity="error">Could not load the code editor: {error}</Alert>;
  if (!ready) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height }}>
        <CircularProgress size={24} aria-label="Loading editor" />
      </Box>
    );
  }
  return (
    <Editor
      height={height}
      language={language}
      path={path}
      value={value}
      loading={null}
      theme={`tim-${scheme}`}
      onChange={(v) => onChange?.(v ?? '')}
      onMount={handleMount}
      options={{
        ...DEFAULT_EDITOR_OPTIONS,
        ariaLabel,
        readOnly,
        ...options,
      }}
    />
  );
}
