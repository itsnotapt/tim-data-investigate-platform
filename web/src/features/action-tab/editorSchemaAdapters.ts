import type { CodeEditorInstance } from '../../components/CodeEditor';
import { getKustoWorkerFor } from '../../lib/monaco';
import type { LoadedEditorSchema } from './editorSchema';
import { normalizeSchema } from './kustoSchema';
import type { QueryParameter } from './queryParameters';
import { setSqlSchema, type SqlSchema } from './sqlSchema';

/** Gives an editor the schema of one `kind`, with the tab's query parameters. */
type Adapter = (
  editor: CodeEditorInstance,
  loaded: LoadedEditorSchema,
  signal: AbortSignal,
  parameters: readonly QueryParameter[],
) => Promise<void>;

/** Query parameters as monaco-kusto's scalar parameters: TIM's types are Kusto type names. */
const scalarParameters = (parameters: readonly QueryParameter[]) =>
  parameters.map(({ name, type }) => ({ name, type }));

const adapters: Record<string, Adapter> = {
  // `.show schema as json` for the scope's database. Monaco wants a cluster: the connection name.
  // The schema replaces the language service's parameters, so they go with it.
  kql: async (editor, { schema, connection, scope }, signal, parameters) => {
    const worker = await getKustoWorkerFor(editor);
    if (!worker || signal.aborted) return;
    const database = typeof scope.database === 'string' ? scope.database : '';
    await worker.setSchemaFromShowSchema(
      normalizeSchema(schema),
      connection,
      database,
      scalarParameters(parameters),
    );
  },
  // A Snowflake account's databases, schemas, tables and columns.
  sql: (editor, { schema }, signal) => setSqlSchema(editor, schema as SqlSchema, signal),
};

/**
 * Gives `editor` a loaded schema, and the tab's query parameters, with the adapter of its kind,
 * which reaches the editor's language worker.
 */
export async function applyEditorSchema(
  editor: CodeEditorInstance,
  loaded: LoadedEditorSchema,
  signal: AbortSignal,
  parameters: readonly QueryParameter[] = [],
): Promise<void> {
  await adapters[loaded.kind]?.(editor, loaded, signal, parameters);
}

/**
 * Gives the editor of a param of `kind` the tab's query parameters, which it suggests: only a
 * `kql` editor takes them.
 */
export async function setEditorParameters(
  editor: CodeEditorInstance,
  kind: string,
  parameters: readonly QueryParameter[],
): Promise<void> {
  if (kind !== 'kql') return;
  const worker = await getKustoWorkerFor(editor);
  await worker?.setParameters(scalarParameters(parameters), []);
}
