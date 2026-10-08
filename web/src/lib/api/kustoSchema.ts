import { getApiClient, type CallOptions } from './client';
import type { components } from './schema';

export type KustoClusterDatabase = components['schemas']['KustoClusterDatabase'];
export type SchemaResponse = components['schemas']['SchemaResponse'];

/** Parsed `.show schema as json` document for the Monaco editor. */
export async function getKustoSchema(
  target: KustoClusterDatabase,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<SchemaResponse['schema']> {
  const res = await client.request<SchemaResponse>({
    method: 'POST',
    path: '/api/kusto/schema',
    body: { cluster: target.cluster, database: target.database },
    ...rest,
  });
  return res.data.schema;
}
