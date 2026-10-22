import { getApiClient, type CallOptions } from './client';
import type { components } from './schema';

export type EditorSchema = components['schemas']['EditorSchemaResponse'];

/**
 * The editor schema of the connection `name` for `scope` (the values of the editor param's
 * `schemaFrom` params, without its connection param); `undefined` when there is none.
 */
export async function getEditorSchema(
  name: string,
  scope: Record<string, unknown>,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<EditorSchema | undefined> {
  const res = await client.request<EditorSchema | undefined>({
    method: 'POST',
    path: `/api/connections/${encodeURIComponent(name)}/schema`,
    body: { scope },
    ...rest,
  });
  return res.data;
}
