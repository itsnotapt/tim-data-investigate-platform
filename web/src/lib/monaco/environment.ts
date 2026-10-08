import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import KustoWorker from './kusto.worker?worker';

/** Maps a Monaco worker label to a worker constructor (Vite `?worker` bundles). */
function createMonacoWorker(label: string): Worker {
  switch (label) {
    case 'kusto':
      return new KustoWorker();
    case 'json':
      return new JsonWorker();
    default:
      // editor worker also serves yaml / plaintext (no language service).
      return new EditorWorker();
  }
}

/** Idempotent: installs `self.MonacoEnvironment.getWorker`. */
export function installMonacoEnvironment(): void {
  self.MonacoEnvironment = {
    ...self.MonacoEnvironment,
    getWorker: (_id, label) => createMonacoWorker(label),
  };
}
