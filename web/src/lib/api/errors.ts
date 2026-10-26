import type { components } from './schema';

export type ProblemDetails = components['schemas']['ProblemDetails'];

/** Client-side (non-server) problem types, never produced by the API. */
export const CLIENT_PROBLEM = {
  timeout: 'urn:tim:client:timeout',
  network: 'urn:tim:client:network',
  invalidResponse: 'urn:tim:client:invalid-response',
} as const;

/**
 * Any non-2xx response, or a transport failure (`status` 0). Carries the RFC 7807 problem from
 * the API (`type`, `title`, `status`, `detail`, `traceId`, `errors`); clients switch on `type`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail: string;
  /** Body `traceId`, else the `x-trace-id` response header. */
  readonly traceId: string | undefined;
  readonly errors: Record<string, string[]> | null;

  constructor(
    problem: Partial<ProblemDetails> & { status: number },
    options?: { cause?: unknown },
  ) {
    const title = problem.title ?? `HTTP ${problem.status}`;
    const detail = problem.detail ?? title;
    super(detail, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.status = problem.status;
    this.type = problem.type ?? 'about:blank';
    this.title = title;
    this.detail = detail;
    this.traceId = problem.traceId || undefined;
    this.errors = problem.errors ?? null;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isTimeout(): boolean {
    return this.type === CLIENT_PROBLEM.timeout;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Builds an `ApiError` from a failed response; tolerates non-JSON bodies (proxies, 502 pages). */
export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  const headerTrace = res.headers.get('x-trace-id') ?? undefined;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const p = (body && typeof body === 'object' ? body : {}) as Partial<ProblemDetails>;
  return new ApiError({
    type: typeof p.type === 'string' ? p.type : undefined,
    title: typeof p.title === 'string' ? p.title : res.statusText || undefined,
    detail: typeof p.detail === 'string' ? p.detail : undefined,
    traceId: (typeof p.traceId === 'string' ? p.traceId : undefined) ?? headerTrace,
    errors: p.errors && typeof p.errors === 'object' ? p.errors : null,
    status: res.status,
  });
}
