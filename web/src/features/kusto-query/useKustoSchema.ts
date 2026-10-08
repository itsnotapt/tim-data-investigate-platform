import { useEffect } from 'react';
import { useNotify } from '../../components/useNotify';
import type { CodeEditorInstance } from '../../components/CodeEditor';
import { formatCluster } from '../../lib/api';
import { getKustoWorkerFor } from '../../lib/monaco';
import { clusterRejectionReason } from './clusterError';
import { fetchKustoSchema } from './kustoSchema';

/**
 * Loads the Kusto schema into the editor's language service: runs when the cluster, database or editor instance changes, so also
 * for the initial values once the editor has mounted. Cached per cluster and database. A response
 * that arrives after the inputs changed (or the editor went away) is ignored. Errors are shown in
 * the snackbar. Does nothing while the cluster or database is empty.
 */
export function useKustoSchema(
  cluster: string,
  database: string,
  editor: CodeEditorInstance | null,
): void {
  const notify = useNotify();
  useEffect(() => {
    if (!editor || cluster.trim() === '' || database.trim() === '') return;
    let stale = false;
    void (async () => {
      try {
        const schema = await fetchKustoSchema(cluster, database);
        if (stale) return;
        const worker = await getKustoWorkerFor(editor);
        if (stale || !worker) return;
        await worker.setSchemaFromShowSchema(schema, formatCluster(cluster), database.trim());
      } catch (e) {
        if (!stale) {
          const reason = clusterRejectionReason(e);
          notify(
            `Failed to load the Kusto schema: ${reason ?? (e instanceof Error ? e.message : String(e))}`,
          );
        }
      }
    })();
    return () => {
      stale = true;
    };
  }, [cluster, database, editor, notify]);
}
