import { getApiClient, type CallOptions } from './client';
import type { components } from './schema';

export type Instance = components['schemas']['Instance'];
export type CatalogueAction = components['schemas']['CatalogueAction'];
export type CatalogueParam = components['schemas']['CatalogueParam'];
export type CatalogueColumn = components['schemas']['CatalogueColumn'];
export type InstanceConnection = components['schemas']['InstanceConnection'];

/** The instance's actions, connections, labels and limits. */
export async function getInstance({
  client = getApiClient(),
  ...rest
}: CallOptions = {}): Promise<Instance> {
  return (await client.request<Instance>({ path: '/api/instance', ...rest })).data;
}
