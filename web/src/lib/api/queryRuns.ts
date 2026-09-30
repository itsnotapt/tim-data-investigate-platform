import { getApiClient, type CallOptions } from './client';
import type { components } from './schema';

export type KustoQueryRequest = components['schemas']['KustoQueryRequest'];
export type KustoQueryRun = components['schemas']['KustoQueryRun'];
export type KustoQueryStats = components['schemas']['KustoQueryStats'];
export type QueryRunStatus = components['schemas']['QueryRunStatus'];
export type QueryRow = Record<string, unknown>;

export const POLL_START_MS = 500;
export const POLL_MAX_INTERVAL_MS = 30_000;
/** Server timeout is 10 min (Q-021); give up after 11. */
export const POLL_MAX_TOTAL_MS = 11 * 60 * 1000;
const POLLS_PER_DOUBLING = 3;

/** The run failed to finish in time: `client` = we stopped polling, `server` = `status: "timedOut"`. */
export class QueryTimeoutError extends Error {
  readonly source: 'client' | 'server';
  readonly queryRunId: string | undefined;

  constructor(source: 'client' | 'server', queryRunId?: string, message?: string) {
    super(
      message ??
        (source === 'client'
          ? 'The query did not finish within 11 minutes. Stopped waiting for the result.'
          : 'The query timed out on the server.'),
    );
    this.name = 'QueryTimeoutError';
    this.source = source;
    this.queryRunId = queryRunId;
  }
}

/** The query executed and failed (`status: "error"`); `message` is the safe `mainError` text. */
export class QueryRunError extends Error {
  readonly queryRunId: string | undefined;

  constructor(message: string, queryRunId?: string) {
    super(message);
    this.name = 'QueryRunError';
    this.queryRunId = queryRunId;
  }
}

export interface QueryResult {
  rows: QueryRow[];
  stats: KustoQueryStats | null;
}

/** Turns a finished run into rows + stats, or throws `QueryRunError` / `QueryTimeoutError`. */
export function handleResult(run: KustoQueryRun): QueryResult {
  switch (run.status) {
    case 'completed':
      return { rows: run.resultData ?? [], stats: run.executionMetrics ?? null };
    case 'error':
      throw new QueryRunError(run.mainError || 'The query failed.', run.queryRunId);
    case 'timedOut':
      throw new QueryTimeoutError('server', run.queryRunId, run.mainError || undefined);
    default:
      throw new Error(`Unexpected query run status '${String(run.status)}'.`);
  }
}

/**
 * Normalise a cluster URL (BUG-29: no forced `.kusto.windows.net`, so Fabric and other hosts work).
 * Trims, strips trailing slashes and prepends `https://` when no scheme was typed; the API
 * rejects hosts outside the allowed Kusto domains with `cluster-not-allowed`.
 */
export function formatCluster(cluster: string): string {
  const c = cluster.trim().replace(/\/+$/, '');
  if (c === '') return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(c) ? c : `https://${c}`;
}

/** Start a run. `status` 200 means finished, 202 means poll. */
export async function startQueryRun(
  request: KustoQueryRequest,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<{ status: number; run: KustoQueryRun }> {
  const res = await client.request<KustoQueryRun>({
    method: 'POST',
    path: '/api/kusto/query',
    // Whitelisted: `requestedBy` is never sent (SEC-03).
    body: {
      cluster: request.cluster,
      database: request.database,
      query: request.query,
      startTime: request.startTime,
      endTime: request.endTime,
    },
    ...rest,
  });
  return { status: res.status, run: res.data };
}

/** Poll a run once. */
export async function getQueryRun(
  queryRunId: string,
  { client = getApiClient(), ...rest }: CallOptions = {},
): Promise<{ status: number; run: KustoQueryRun }> {
  const res = await client.request<KustoQueryRun>({
    path: `/api/kusto/query/${encodeURIComponent(queryRunId)}`,
    ...rest,
  });
  return { status: res.status, run: res.data };
}

/** Delay before poll number `n` (0-based): 500 ms, doubling every 3 polls, capped at 30 s. */
export function pollDelay(n: number): number {
  return Math.min(POLL_START_MS * 2 ** Math.floor(n / POLLS_PER_DOUBLING), POLL_MAX_INTERVAL_MS);
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error
    ? reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RunQueryOptions extends CallOptions {
  /** Called with each non-final run (status `created`). */
  onPoll?: (run: KustoQueryRun) => void;
  /** Expand bare cluster names (default true). */
  formatCluster?: boolean;
}

/**
 * POST the query, then poll while the run is `created` (202). Cancel with `signal` (BUG-30);
 * rejects with the signal's reason. Resolves with rows + stats, or throws `QueryRunError`,
 * `QueryTimeoutError` or `ApiError`.
 */
export async function runQuery(
  request: KustoQueryRequest,
  options: RunQueryOptions = {},
): Promise<QueryResult> {
  const { onPoll, formatCluster: format = true, ...call } = options;
  const { signal } = call;
  const started = Date.now();

  const first = await startQueryRun(
    format ? { ...request, cluster: formatCluster(request.cluster) } : request,
    call,
  );
  if (first.status === 200) return handleResult(first.run);
  const id = first.run.queryRunId;
  if (!id) throw new Error('queryRunId missing from response.');
  onPoll?.(first.run);

  for (let n = 0; ; n++) {
    const remaining = POLL_MAX_TOTAL_MS - (Date.now() - started);
    if (remaining <= 0) throw new QueryTimeoutError('client', id);
    await sleep(Math.min(pollDelay(n), remaining), signal);
    const { status, run } = await getQueryRun(id, call);
    if (status === 200) return handleResult(run);
    onPoll?.(run);
  }
}
