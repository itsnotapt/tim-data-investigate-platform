import { formatCluster, getKustoSchema } from '../../lib/api';

/**
 * Unwraps the schema document for `setSchemaFromShowSchema` (the wire shape is tolerated in
 * several variants). Accepted: the parsed document (`{Databases: ...}`), an object
 * wrapping it in `ClusterSchema` / `DatabaseSchema` (object or JSON string), a JSON string, or
 * rows (`[{ClusterSchema: "<json>"}]`, optionally under `data`).
 */
export function normalizeSchema(value: unknown): object {
  return withDatabaseDefaults(unwrapSchema(value));
}

/**
 * monaco-kusto reads these database members unconditionally (`Object.values(Graphs)` throws on
 * undefined), but `.show schema as json` omits the ones a cluster version does not know.
 */
function withDatabaseDefaults(schema: object): object {
  const dbs = (schema as { Databases?: Record<string, unknown> }).Databases;
  if (!dbs || typeof dbs !== 'object') return schema;
  const filled = Object.fromEntries(
    Object.entries(dbs).map(([name, db]) => [
      name,
      db && typeof db === 'object'
        ? { Tables: {}, Functions: {}, EntityGroups: {}, Graphs: {}, ...db }
        : db,
    ]),
  );
  return { ...schema, Databases: filled };
}

function unwrapSchema(value: unknown, depth = 0): object {
  if (depth > 4) throw new Error('Unrecognised Kusto schema response.');
  if (typeof value === 'string') return unwrapSchema(JSON.parse(value) as unknown, depth + 1);
  if (Array.isArray(value)) return unwrapSchema(value[0], depth + 1);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if ('Databases' in o) return o;
    for (const key of ['ClusterSchema', 'DatabaseSchema', 'schema', 'data']) {
      if (o[key] !== undefined && o[key] !== null) return unwrapSchema(o[key], depth + 1);
    }
  }
  throw new Error('Unrecognised Kusto schema response.');
}

const cache = new Map<string, Promise<object>>();

const schemaKey = (cluster: string, database: string): string =>
  `${formatCluster(cluster)}|${database.trim()}`;

/**
 * Schema for a cluster and database, cached per pair. A failed fetch is not cached. Only one
 * request is made for concurrent callers.
 */
export function fetchKustoSchema(cluster: string, database: string): Promise<object> {
  const key = schemaKey(cluster, database);
  let hit = cache.get(key);
  if (!hit) {
    // Not tied to one caller's signal: the shared result is reused by the next caller.
    hit = getKustoSchema({ cluster: formatCluster(cluster), database: database.trim() }).then(
      normalizeSchema,
    );
    cache.set(key, hit);
    hit.catch(() => {
      if (cache.get(key) === hit) cache.delete(key);
    });
  }
  return hit;
}

export function clearKustoSchemaCache(): void {
  cache.clear();
}
