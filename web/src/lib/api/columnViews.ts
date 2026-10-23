import { getApiClient, type CallOptions } from './client';
import type { components } from './schema';

export type ColumnView = components['schemas']['ColumnView'];
export type ColumnViewFields = components['schemas']['ColumnViewFields'];
export type NewColumnView = components['schemas']['NewColumnView'];
export type SavedFrom = components['schemas']['SavedFrom'];

const BASE = '/api/columnViews';
const item = (viewId: string) => `${BASE}/${encodeURIComponent(viewId)}`;

/** Every column view the analyst can see: their own and the shared ones. */
export async function listColumnViews({
  client = getApiClient(),
  ...rest
}: CallOptions = {}): Promise<ColumnView[]> {
  return (await client.request<ColumnView[]>({ path: BASE, ...rest })).data;
}

/** Saves a new column view owned by the analyst. */
export async function createColumnView(
  view: NewColumnView,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<ColumnView> {
  const res = await client.request<ColumnView>({ method: 'POST', path: BASE, body: view, ...rest });
  return res.data;
}

/** Replaces the name, sharing and state of a column view the analyst owns. */
export async function replaceColumnView(
  viewId: string,
  view: ColumnViewFields,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<ColumnView> {
  const res = await client.request<ColumnView>({
    method: 'PUT',
    path: item(viewId),
    body: view,
    ...rest,
  });
  return res.data;
}

/** Deletes a column view the analyst owns. */
export async function deleteColumnView(
  viewId: string,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<void> {
  await client.request({ method: 'DELETE', path: item(viewId), ...rest });
}

/** Hides or unhides a column view for the analyst only. */
export async function setColumnViewHidden(
  viewId: string,
  hidden: boolean,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<void> {
  await client.request({
    method: hidden ? 'PUT' : 'DELETE',
    path: `${item(viewId)}/hidden`,
    ...rest,
  });
}
