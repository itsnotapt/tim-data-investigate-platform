import { apiScopes, getAuthClient } from '../auth';
import { getConfig } from '../config/runtimeConfig';
import { ApiError, CLIENT_PROBLEM, apiErrorFromResponse } from './errors';

export const DEFAULT_TIMEOUT_MS = 30_000;

export interface RequestOptions {
  /** Cancels the request (rejects with the signal's reason, normally an `AbortError`). */
  signal?: AbortSignal;
  /** Per-request timeout; `0` disables it. Default 30 s. */
  timeoutMs?: number;
}

export interface CallOptions extends RequestOptions {
  /** Defaults to the app-wide client. */
  client?: ApiClient;
}

export interface ApiRequest extends RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path below the API origin, e.g. `/api/templates/queries`. */
  path: string;
  query?: Record<string, string | boolean | undefined | null>;
  body?: unknown;
}

export interface ApiResponse<T> {
  status: number;
  data: T;
  traceId: string | undefined;
}

export interface ApiClient {
  /** Resolves on 2xx (204 gives `data: undefined`); rejects with `ApiError` otherwise. */
  request<T = unknown>(req: ApiRequest): Promise<ApiResponse<T>>;
}

export interface ApiClientOptions {
  /** API origin without trailing slash; empty means same origin. */
  baseUrl: string;
  /** Acquires a bearer token silently; called for every request. */
  getToken: () => Promise<string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Fields the server owns; never sent, whatever the caller passes. */
const SERVER_OWNED = new Set(['requestedBy', 'createdBy', 'updatedBy', 'updated', 'dateTimeUtc']);

/** Removes server-owned identity fields from a request body (top level, or per array item). */
export function stripServerOwned<T>(body: T): T {
  const strip = (o: unknown): unknown =>
    o && typeof o === 'object' && !Array.isArray(o)
      ? Object.fromEntries(Object.entries(o).filter(([k]) => !SERVER_OWNED.has(k)))
      : o;
  return (Array.isArray(body) ? body.map(strip) : strip(body)) as T;
}

function buildUrl(baseUrl: string, path: string, query: ApiRequest['query']): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  const qs = params.toString();
  return `${baseUrl}${path}${qs ? `?${qs}` : ''}`;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function send(req: ApiRequest, token: string): Promise<Response> {
    const timeoutMs = req.timeoutMs ?? defaultTimeout;
    const controller = new AbortController();
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : undefined;
    const onAbort = () => controller.abort(req.signal?.reason);
    if (req.signal?.aborted) onAbort();
    req.signal?.addEventListener('abort', onAbort, { once: true });

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, application/problem+json',
    };
    if (req.body !== undefined) headers['Content-Type'] = 'application/json';

    try {
      return await doFetch(buildUrl(options.baseUrl, req.path, req.query), {
        method: req.method ?? 'GET',
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: controller.signal,
      });
    } catch (e) {
      if (timedOut) {
        throw new ApiError(
          {
            status: 0,
            type: CLIENT_PROBLEM.timeout,
            title: 'Request timed out',
            detail: `The request did not complete within ${Math.round(timeoutMs / 1000)} s.`,
          },
          { cause: e },
        );
      }
      if (req.signal?.aborted) throw req.signal.reason ?? e;
      throw new ApiError(
        {
          status: 0,
          type: CLIENT_PROBLEM.network,
          title: 'Network error',
          detail: 'The server could not be reached.',
        },
        { cause: e },
      );
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    async request<T>(req: ApiRequest): Promise<ApiResponse<T>> {
      let res = await send(req, await options.getToken());
      if (res.status === 401) {
        // One re-auth attempt: a fresh silent token acquisition, then a single retry.
        void res.body?.cancel().catch(() => undefined);
        res = await send(req, await options.getToken());
      }
      if (!res.ok) throw await apiErrorFromResponse(res);

      const traceId = res.headers.get('x-trace-id') ?? undefined;
      if (res.status === 204) return { status: 204, data: undefined as T, traceId };
      try {
        return { status: res.status, data: (await res.json()) as T, traceId };
      } catch (e) {
        throw new ApiError(
          {
            status: res.status,
            type: CLIENT_PROBLEM.invalidResponse,
            title: 'Invalid response',
            detail: 'The server returned a malformed response.',
            traceId,
          },
          { cause: e },
        );
      }
    },
  };
}

let cached: ApiClient | undefined;

/** The app-wide client: runtime-config base URL, silent token per request. */
export function getApiClient(): ApiClient {
  cached ??= createApiClient({
    baseUrl: getConfig().apiEndpoint,
    getToken: () => getAuthClient().acquireToken(apiScopes(getConfig().auth.clientId)),
  });
  return cached;
}

/** Test helper. */
export function resetApiClientCache(): void {
  cached = undefined;
}
