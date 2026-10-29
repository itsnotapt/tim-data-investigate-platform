import { getApiClient, type CallOptions } from './client';
import type { components } from './schema';

export type Me = components['schemas']['Me'];

/** The signed-in analyst as the API knows them. */
export async function getMe({ client = getApiClient(), ...rest }: CallOptions = {}): Promise<Me> {
  return (await client.request<Me>({ path: '/api/me', ...rest })).data;
}
