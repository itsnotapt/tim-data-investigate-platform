import { Editor, type OnMount } from '@monaco-editor/react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import { useColorScheme, useTheme } from '@mui/material/styles';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { DEFAULT_EDITOR_OPTIONS } from './codeEditorOptions';
import {
  loadMonaco,
  loadMonacoKusto,
  TIM_THEME_NAMES,
  type EditorLanguage,
  type TimPalettes,
} from '../lib/monaco';

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
 * Monaco wrapper using the locally bundled monaco-editor (no CDN), themed `tim-light` or `tim-dark`
 * to match the colour scheme. The model and editor are disposed on unmount.
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
  // Same scheme as `app/theme.ts` and `public/theme-init.js`. The page's Monaco theme is picked
  // only here.
  const { colorScheme } = useColorScheme();
  const { colorSchemes } = useTheme();
  const palettes = useMemo<TimPalettes>(
    () => ({ light: colorSchemes.light!.palette, dark: colorSchemes.dark!.palette }),
    [colorSchemes],
  );

  useEffect(() => {
    let cancelled = false;
    (language === 'kusto' ? loadMonacoKusto(palettes) : loadMonaco(palettes)).then(
      () => !cancelled && setLoadedLanguage(language),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [language, palettes]);

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
      theme={TIM_THEME_NAMES[colorScheme ?? 'light']}
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
