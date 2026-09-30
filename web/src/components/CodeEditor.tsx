import { Editor, type OnMount } from '@monaco-editor/react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { DEFAULT_EDITOR_OPTIONS } from './codeEditorOptions';
import { loadMonaco, loadMonacoKusto, type EditorLanguage } from '../lib/monaco';

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
