import { getApiClient, type CallOptions } from './client';
import { isApiError } from './errors';
import type { components } from './schema';

export type Run = components['schemas']['Run'];
export type RunStatus = components['schemas']['RunStatus'];
export type RunColumn = components['schemas']['RunColumn'];
export type RunRow = components['schemas']['RunRow'];
export type RowsPage = components['schemas']['RowsPage'];

const BASE = '/api/runs';
const item = (runId: string) => `${BASE}/${encodeURIComponent(runId)}`;

/** Starts a run of `action` with `params`; the run may already have ended. */
export async function startRun(
  action: string,
  params: Record<string, unknown>,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<Run> {
  const res = await client.request<Run>({
    method: 'POST',
    path: BASE,
    body: { action, params },
    ...rest,
  });
  return res.data;
}

export async function getRun(
  runId: string,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<Run> {
  return (await client.request<Run>({ path: item(runId), ...rest })).data;
}

/** The rows with `startRow <= row < endRow`; the server may return fewer, up to its page size. */
export async function getRunRows(
  runId: string,
  startRow: number,
  endRow: number,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<RowsPage> {
  const res = await client.request<RowsPage>({
    path: `${item(runId)}/rows`,
    query: { startRow: String(startRow), endRow: String(endRow) },
    ...rest,
  });
  return res.data;
}

/** A succeeded run whose stored rows are gone (`410 results-gone`). */
export function isResultsGone(e: unknown): boolean {
  return isApiError(e) && e.type === 'urn:tim:problem:results-gone';
}
