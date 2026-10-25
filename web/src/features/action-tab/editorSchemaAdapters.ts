import type { CodeEditorInstance } from '../../components/CodeEditor';
import { getKustoWorkerFor } from '../../lib/monaco';
import type { LoadedEditorSchema } from './editorSchema';
import { normalizeSchema } from './kustoSchema';

/** Gives an editor the schema of one `kind`. */
type Adapter = (
  editor: CodeEditorInstance,
  loaded: LoadedEditorSchema,
  signal: AbortSignal,
) => Promise<void>;

const adapters: Record<string, Adapter> = {
  // `.show schema as json` for the scope's database. Monaco wants a cluster: the connection name.
  kql: async (editor, { schema, connection, scope }, signal) => {
    const worker = await getKustoWorkerFor(editor);
    if (!worker || signal.aborted) return;
    const database = typeof scope.database === 'string' ? scope.database : '';
    await worker.setSchemaFromShowSchema(normalizeSchema(schema), connection, database);
  },
};

/**
 * Gives `editor` a loaded schema with the adapter of its kind, which reaches the editor's language
 * worker.
 */
export async function applyEditorSchema(
  editor: CodeEditorInstance,
  loaded: LoadedEditorSchema,
  signal: AbortSignal,
): Promise<void> {
  await adapters[loaded.kind]?.(editor, loaded, signal);
}
