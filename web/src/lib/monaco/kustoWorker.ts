import type * as Monaco from 'monaco-editor';
import { loadMonacoKusto } from './loader';

/** Resolved Kusto worker proxy (has `setSchemaFromShowSchema(schema, clusterUri, database)`). */
export type KustoWorkerProxy = Awaited<
  ReturnType<
    Awaited<
      ReturnType<
        typeof import('@kusto/monaco-kusto/release/esm/monaco.contribution').getKustoWorker
      >
    >
  >
>;

/**
 * Returns the Kusto worker bound to the model's uri, or null if the editor has no model. `useKustoSchema`
 * calls `setSchemaFromShowSchema` on the result; schema fetching lives there.
 */
export async function getKustoWorkerFor(
  editor: Monaco.editor.IStandaloneCodeEditor,
): Promise<KustoWorkerProxy | null> {
  const model = editor.getModel();
  if (!model) return null;
  await loadMonacoKusto();
  const { getKustoWorker } = await import('@kusto/monaco-kusto/release/esm/monaco.contribution');
  const accessor = await getKustoWorker();
  return accessor(model.uri);
}
