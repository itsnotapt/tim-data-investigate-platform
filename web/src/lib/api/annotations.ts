import { getApiClient, type CallOptions } from './client';
import type { components } from './schema';

export type Annotations = components['schemas']['Annotations'];
export type ChangedAnnotations = components['schemas']['ChangedAnnotations'];
export type AnnotationChangesPage = components['schemas']['AnnotationChangesPage'];

const BASE = '/api/annotations';

/** Sets the label of every one of `ids`, or clears it with `null`, under one version. */
export async function changeAnnotations(
  ids: readonly string[],
  label: string | null,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<ChangedAnnotations> {
  const res = await client.request<ChangedAnnotations>({
    method: 'PATCH',
    path: BASE,
    body: { ids, label },
    ...rest,
  });
  return res.data;
}

/** The ids changed after version `since`, as they now are; ask again from `next` while `hasMore`. */
export async function getAnnotationChanges(
  since: number,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<AnnotationChangesPage> {
  const res = await client.request<AnnotationChangesPage>({
    path: `${BASE}/changes`,
    query: { since: String(since) },
    ...rest,
  });
  return res.data;
}
