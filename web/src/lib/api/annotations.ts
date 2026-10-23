import { getApiClient, type CallOptions } from './client';
import type { components } from './schema';

export type Annotations = components['schemas']['Annotations'];
export type ChangedAnnotations = components['schemas']['ChangedAnnotations'];
export type AnnotationChangesPage = components['schemas']['AnnotationChangesPage'];
export type AnnotationsChange = components['schemas']['AnnotationsChange'];
export type TagSuggestions = components['schemas']['TagSuggestions'];

const BASE = '/api/annotations';

/**
 * Changes every one of `change.ids` under one version: the label (`null` clears it, leaving it out
 * keeps it), the tags and a comment.
 */
export async function changeAnnotations(
  change: AnnotationsChange,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<ChangedAnnotations> {
  const res = await client.request<ChangedAnnotations>({
    method: 'PATCH',
    path: BASE,
    body: change,
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

/** Tags that start with `prefix`, ignoring case: the analyst's recent ones, then the most used. */
export async function getTagSuggestions(
  prefix: string,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<TagSuggestions> {
  const res = await client.request<TagSuggestions>({
    path: '/api/tags/suggestions',
    query: { prefix },
    ...rest,
  });
  return res.data;
}
