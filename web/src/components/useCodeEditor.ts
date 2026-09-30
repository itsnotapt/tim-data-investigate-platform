import { useCallback, useRef } from 'react';
import { getKustoWorkerFor, type KustoWorkerProxy } from '../lib/monaco';
import type { CodeEditorInstance } from './CodeEditor';

/**
 * Handle for a `CodeEditor`: pass `onMount` to it, then use `getEditor` / `getKustoWorker` (for
 * `setSchemaFromShowSchema`, P4-10). Both getters are stable across renders.
 */
export function useCodeEditor() {
  const ref = useRef<CodeEditorInstance | null>(null);
  const onMount = useCallback((editor: CodeEditorInstance) => {
    ref.current = editor;
    editor.onDidDispose(() => {
      if (ref.current === editor) ref.current = null;
    });
  }, []);
  const getEditor = useCallback(() => ref.current, []);
  const getKustoWorker = useCallback(async (): Promise<KustoWorkerProxy | null> => {
    const editor = ref.current;
    return editor ? getKustoWorkerFor(editor) : null;
  }, []);
  return { onMount, getEditor, getKustoWorker };
}
