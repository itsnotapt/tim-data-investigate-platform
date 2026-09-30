import { getApiClient, stripServerOwned, type CallOptions } from './client';
import type { components, operations } from './schema';

export type QueryTemplate = components['schemas']['QueryTemplate'];
export type QueryTemplateCreate = components['schemas']['QueryTemplateCreate'];
export type QueryTemplateReplace = components['schemas']['QueryTemplateReplace'];
export type PatchOperation = components['schemas']['PatchOperation'];
export type ListTemplatesQuery = NonNullable<operations['listTemplates']['parameters']['query']>;

const BASE = '/api/templates/queries';
const item = (uuid: string) => `${BASE}/${encodeURIComponent(uuid)}`;

/** `includeDeleted` defaults to false server-side (BUG-05); the Query Manager passes true. */
export async function listTemplates(
  query: ListTemplatesQuery = {},
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<QueryTemplate[]> {
  const res = await client.request<QueryTemplate[]>({
    path: BASE,
    query: { since: query.since, includeDeleted: query.includeDeleted },
    ...rest,
  });
  return res.data;
}

export async function getTemplate(
  uuid: string,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<QueryTemplate> {
  return (await client.request<QueryTemplate>({ path: item(uuid), ...rest })).data;
}

export async function createTemplate(
  template: QueryTemplateCreate,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<QueryTemplate> {
  const res = await client.request<QueryTemplate>({
    method: 'POST',
    path: BASE,
    body: stripServerOwned(template),
    ...rest,
  });
  return res.data;
}

/** PUT is update-only; `template.uuid` must equal `uuid`. */
export async function replaceTemplate(
  uuid: string,
  template: QueryTemplateReplace,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<QueryTemplate> {
  const res = await client.request<QueryTemplate>({
    method: 'PUT',
    path: item(uuid),
    body: stripServerOwned(template),
    ...rest,
  });
  return res.data;
}

/** RFC 6902 patch. Protected paths: `/uuid`, `/createdBy`, `/updatedBy`, `/updated`. */
export async function patchTemplate(
  uuid: string,
  operations: PatchOperation[],
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<QueryTemplate> {
  const res = await client.request<QueryTemplate>({
    method: 'PATCH',
    path: item(uuid),
    body: operations,
    ...rest,
  });
  return res.data;
}

/** Restore a soft-deleted template. */
export function restoreTemplate(uuid: string, opts: CallOptions = {}): Promise<QueryTemplate> {
  return patchTemplate(uuid, [{ op: 'replace', path: '/isDeleted', value: false }], opts);
}

/** Soft delete (idempotent). */
export async function deleteTemplate(
  uuid: string,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<void> {
  await client.request({ method: 'DELETE', path: item(uuid), ...rest });
}
