import { getApiClient, type CallOptions } from './client';
import type { components } from './schema';

export type Instance = components['schemas']['Instance'];
export type CatalogueAction = components['schemas']['CatalogueAction'];
export type CatalogueParam = components['schemas']['CatalogueParam'];
export type CatalogueColumn = components['schemas']['CatalogueColumn'];
export type InstanceConnection = components['schemas']['InstanceConnection'];
export type InstanceLabel = components['schemas']['InstanceLabel'];
export type LabelColour = InstanceLabel['colour'];
export type LabelSymbol = NonNullable<InstanceLabel['symbol']>;

/** The instance's actions, connections, labels and limits. */
export async function getInstance({
  client = getApiClient(),
  ...rest
}: CallOptions = {}): Promise<Instance> {
  return (await client.request<Instance>({ path: '/api/instance', ...rest })).data;
}

export type PivotRows = components['schemas']['PivotRows'];
export type PivotResolution = components['schemas']['PivotResolution'];

/** Resolves a pivot into the action `key` from the selected rows, sent by value. */
export async function resolvePivot(
  key: string,
  pivot: PivotRows,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<PivotResolution> {
  const res = await client.request<PivotResolution>({
    method: 'POST',
    path: `/api/actions/${encodeURIComponent(key)}/resolve`,
    body: { pivot },
    ...rest,
  });
  return res.data;
}

export type DeclaredParameter = components['schemas']['DeclaredParameter'];
export type DeclareStatement = components['schemas']['DeclareStatement'];

/**
 * The statement the action `key` puts before its query to declare the query parameters, by name
 * and type; `undefined` when it declares nothing.
 */
export async function getDeclareStatement(
  key: string,
  parameters: readonly DeclaredParameter[],
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<string | undefined> {
  const res = await client.request<DeclareStatement | undefined>({
    method: 'POST',
    path: `/api/actions/${encodeURIComponent(key)}/declareStatement`,
    body: { parameters },
    ...rest,
  });
  return res.data?.declareStatement;
}
