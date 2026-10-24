import { getApiClient, type CallOptions } from './client';
import type { components } from './schema';

export type Preset = components['schemas']['Preset'];
export type PresetFields = components['schemas']['PresetFields'];
export type PresetInput = NonNullable<PresetFields['inputs']>[number];

const BASE = '/api/presets';
const item = (presetId: string) => `${BASE}/${encodeURIComponent(presetId)}`;

/** Every preset the analyst can see: their own and the shared ones. */
export async function listPresets({ client = getApiClient(), ...rest }: CallOptions = {}): Promise<
  Preset[]
> {
  return (await client.request<Preset[]>({ path: BASE, ...rest })).data;
}

/** Saves a new preset owned by the analyst. */
export async function createPreset(
  preset: PresetFields,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<Preset> {
  const res = await client.request<Preset>({ method: 'POST', path: BASE, body: preset, ...rest });
  return res.data;
}

/** Replaces the whole of a preset the analyst owns. */
export async function replacePreset(
  presetId: string,
  preset: PresetFields,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<Preset> {
  const res = await client.request<Preset>({
    method: 'PUT',
    path: item(presetId),
    body: preset,
    ...rest,
  });
  return res.data;
}

/** Deletes a preset the analyst owns. */
export async function deletePreset(
  presetId: string,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<void> {
  await client.request({ method: 'DELETE', path: item(presetId), ...rest });
}

/** A preset as an action file, in YAML; only for an action whose catalogue entry has `actionFile`. */
export async function getPresetActionFile(
  presetId: string,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<string> {
  const res = await client.request<string>({
    path: `${item(presetId)}/actionFile`,
    accept: 'application/yaml',
    ...rest,
  });
  return res.data;
}

/** Hides or unhides a preset for the analyst only. */
export async function setPresetHidden(
  presetId: string,
  hidden: boolean,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<void> {
  await client.request({
    method: hidden ? 'PUT' : 'DELETE',
    path: `${item(presetId)}/hidden`,
    ...rest,
  });
}
