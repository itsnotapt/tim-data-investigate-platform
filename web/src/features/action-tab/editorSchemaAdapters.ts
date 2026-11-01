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

/**
 * The editor whose schema and query parameters the Kusto language service holds. monaco-kusto has
 * one of each for the page, so the editor given them last takes them from every other.
 */
let kustoHolder: CodeEditorInstance | null = null;

/**
 * The last call to the Kusto language service. A schema reaches its worker after a round trip,
 * carrying the query parameters it was given, which replace the worker's: parameters given while
 * it loads are given after it, so they aren't replaced by older ones.
 */
let kustoTurn: Promise<unknown> = Promise.resolve();

/** Calls the Kusto language service once the calls before have finished, failed or not. */
function inKustoTurn(call: () => Promise<void>): Promise<void> {
  const next = kustoTurn.then(call);
  kustoTurn = next.catch(() => undefined);
  return next;
}

const adapters: Record<string, Adapter> = {
  // `.show schema as json` for the scope's database. Monaco wants a cluster: the connection name.
  // The schema replaces the language service's parameters, so they go with it.
  kql: (editor, loaded, signal, parameters) =>
    inKustoTurn(() => giveKustoSchema(editor, loaded, signal, parameters)),
  // A Snowflake account's databases, schemas, tables and columns.
  sql: (editor, { schema }, signal) => setSqlSchema(editor, schema as SqlSchema, signal),
};

/** Gives the Kusto language service `editor`'s schema, with the query parameters that go with it. */
async function giveKustoSchema(
  editor: CodeEditorInstance,
  { schema, connection, scope }: LoadedEditorSchema,
  signal: AbortSignal,
  parameters: readonly QueryParameter[],
): Promise<void> {
  const worker = await getKustoWorkerFor(editor);
  if (!worker || signal.aborted) return;
  kustoHolder = editor;
  const database = typeof scope.database === 'string' ? scope.database : '';
  await worker.setSchemaFromShowSchema(
    normalizeSchema(schema),
    connection,
    database,
    scalarParameters(parameters),
  );
}

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
 * `kql` editor takes them, while no other editor holds the language service.
 */
export async function setEditorParameters(
  editor: CodeEditorInstance,
  kind: string,
  parameters: readonly QueryParameter[],
): Promise<void> {
  if (kind !== 'kql') return;
  await inKustoTurn(async () => {
    // Another editor's are left alone: this one's go with its schema when it's focused.
    if (kustoHolder !== null && kustoHolder !== editor) return;
    await giveKustoParameters(editor, parameters);
  });
}

/** Gives the Kusto language service `editor`'s query parameters, keeping the schema it holds. */
async function giveKustoParameters(
  editor: CodeEditorInstance,
  parameters: readonly QueryParameter[],
): Promise<void> {
  const worker = await getKustoWorkerFor(editor);
  if (!worker) return;
  kustoHolder = editor;
  await worker.setParameters(scalarParameters(parameters), []);
}

/**
 * Gives the language service back to the editor of a param of `kind`, when another editor holds
 * it: the editor's last `loaded` schema with the tab's query parameters, or the parameters alone
 * before a schema has loaded. Only a `kql` editor shares it.
 */
export async function claimEditorSchema(
  editor: CodeEditorInstance,
  kind: string,
  loaded: LoadedEditorSchema | null,
  parameters: readonly QueryParameter[],
): Promise<void> {
  if (kind !== 'kql') return;
  await inKustoTurn(async () => {
    if (kustoHolder === editor) return;
    if (loaded) await giveKustoSchema(editor, loaded, new AbortController().signal, parameters);
    else await giveKustoParameters(editor, parameters);
  });
}
