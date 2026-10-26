import { useEffect } from 'react';
import { useNotify } from '../../components/useNotify';
import { getEditorSchema, type CatalogueParam, type EditorSchema } from '../../lib/api';

type Scope = Record<string, unknown>;

/** An editor schema, with the connection and scope it came from. */
export interface LoadedEditorSchema {
  kind: string;
  schema: unknown;
  connection: string;
  scope: Scope;
}

/**
 * Gives a loaded schema to an editor. `signal` aborts once the schema is stale; a rejection is
 * shown in the snackbar.
 */
export type SchemaHandler = (
  loaded: LoadedEditorSchema,
  signal: AbortSignal,
) => Promise<void> | void;

const cache = new Map<string, Promise<EditorSchema | undefined>>();

const cacheKey = (connection: string, scope: Scope): string =>
  JSON.stringify([connection, Object.entries(scope).sort(([a], [b]) => (a < b ? -1 : 1))]);

/**
 * The editor schema of `connection` for `scope`, cached per pair. A failed fetch is not cached.
 * Only one request is made for concurrent callers.
 */
function fetchEditorSchema(connection: string, scope: Scope): Promise<EditorSchema | undefined> {
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

/** How long the connection and scope must stay unchanged before their schema loads. */
const SETTLE_MS = 400;

/**
 * Loads the schema of an editor param and hands it to `onSchema` once its connection and scope
 * have stayed unchanged for `SETTLE_MS` (a pill's value changes on each keystroke), `onSchema` is
 * set (the editor has mounted) and each of its `schemaFrom` params has a value. A schema that
 * arrives after they changed is dropped, and a failure is shown in the snackbar. `onSchema` must
 * keep its identity between renders.
 */
export function useEditorSchema(
  param: CatalogueParam | undefined,
  params: readonly CatalogueParam[],
  values: Record<string, unknown>,
  onSchema: SchemaHandler | null,
): void {
  const notify = useNotify();
  const target = param ? schemaTarget(param, params, values) : null;
  const key = target ? cacheKey(target.connection, target.scope) : null;
  useEffect(() => {
    if (!onSchema || key === null) return;
    const [connection, entries] = JSON.parse(key) as [string, [string, unknown][]];
    const scope = Object.fromEntries(entries);
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(() => {
      fetchEditorSchema(connection, scope)
        .then(async (found) => {
          if (!found || signal.aborted) return;
          await onSchema({ kind: found.kind, schema: found.schema, connection, scope }, signal);
        })
        .catch((e: unknown) => {
          if (!signal.aborted) {
            notify(
              `Failed to load the editor schema: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        });
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [onSchema, key, notify]);
}

export function clearEditorSchemaCache(): void {
  cache.clear();
}
