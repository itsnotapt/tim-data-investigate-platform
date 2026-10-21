import { useEffect } from 'react';
import type { CodeEditorInstance } from '../../components/CodeEditor';
import { useNotify } from '../../components/useNotify';
import { getEditorSchema, type CatalogueParam, type EditorSchema } from '../../lib/api';
import { getKustoWorkerFor } from '../../lib/monaco';
import { normalizeSchema } from '../kusto-query/kustoSchema';

type Scope = Record<string, unknown>;

/** Gives an editor the schema of one `kind`, for the connection and scope it came from. */
type Adapter = (
  editor: CodeEditorInstance,
  schema: unknown,
  connection: string,
  scope: Scope,
  signal: AbortSignal | undefined,
) => Promise<void>;

const adapters: Record<string, Adapter> = {
  // `.show schema as json` for the scope's database. Monaco wants a cluster: the connection name.
  kql: async (editor, schema, connection, scope, signal) => {
    const worker = await getKustoWorkerFor(editor);
    if (!worker || signal?.aborted) return;
    const database = typeof scope.database === 'string' ? scope.database : '';
    await worker.setSchemaFromShowSchema(normalizeSchema(schema), connection, database);
  },
};

const cache = new Map<string, Promise<EditorSchema>>();

const cacheKey = (connection: string, scope: Scope): string =>
  JSON.stringify([connection, Object.entries(scope).sort(([a], [b]) => (a < b ? -1 : 1))]);

/**
 * The editor schema of `connection` for `scope`, cached per pair. A failed fetch is not cached.
 * Only one request is made for concurrent callers.
 */
function fetchEditorSchema(connection: string, scope: Scope): Promise<EditorSchema> {
  const key = cacheKey(connection, scope);
  let hit = cache.get(key);
  if (!hit) {
    hit = getEditorSchema(connection, scope);
    cache.set(key, hit);
    hit.catch(() => {
      if (cache.get(key) === hit) cache.delete(key);
    });
  }
  return hit;
}

/**
 * Loads the editor schema of `connection` for `scope` into `editor`, with the adapter of its kind.
 * Does nothing more once `signal` is aborted.
 */
export async function loadEditorSchema(
  editor: CodeEditorInstance,
  connection: string,
  scope: Scope,
  { signal }: { signal?: AbortSignal } = {},
): Promise<void> {
  const { kind, schema } = await fetchEditorSchema(connection, scope);
  const adapter = kind === null ? undefined : adapters[kind];
  if (signal?.aborted) return;
  await adapter?.(editor, schema, connection, scope, signal);
}

/**
 * The connection and scope of an editor param, from its `schemaFrom` params' values: the value of
 * the `connection` one, and the others by name. `null` until each of them has a value.
 */
function schemaTarget(
  param: CatalogueParam,
  params: readonly CatalogueParam[],
  values: Record<string, unknown>,
): { connection: string; scope: Scope } | null {
  let connection: string | null = null;
  const scope: Scope = {};
  for (const name of param.schemaFrom ?? []) {
    const value = values[name];
    if (value === undefined || value === null || value === '') return null;
    if (params.find((p) => p.name === name)?.kind !== 'connection') scope[name] = value;
    else if (typeof value === 'string') connection = value;
  }
  return connection === null ? null : { connection, scope };
}

/**
 * Loads the schema of an editor param into `editor` whenever its connection or scope changes, once
 * the editor has mounted and each of its `schemaFrom` params has a value. A schema that arrives
 * after they changed is ignored, and a failure is shown in the snackbar.
 */
export function useEditorSchema(
  editor: CodeEditorInstance | null,
  param: CatalogueParam | undefined,
  params: readonly CatalogueParam[],
  values: Record<string, unknown>,
): void {
  const notify = useNotify();
  const target = param ? schemaTarget(param, params, values) : null;
  const key = target ? cacheKey(target.connection, target.scope) : null;
  useEffect(() => {
    if (!editor || key === null) return;
    const [connection, entries] = JSON.parse(key) as [string, [string, unknown][]];
    const controller = new AbortController();
    loadEditorSchema(editor, connection, Object.fromEntries(entries), {
      signal: controller.signal,
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) {
        notify(`Failed to load the editor schema: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    return () => controller.abort();
  }, [editor, key, notify]);
}

export function clearEditorSchemaCache(): void {
  cache.clear();
}
