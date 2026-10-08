import { HttpResponse, http, type HttpHandler } from 'msw';
import type { components } from '../../lib/api/schema';

type Problem = components['schemas']['ProblemDetails'];
type Run = components['schemas']['KustoQueryRun'];

/** Origin used by tests that build clients with `baseUrl: TEST_API`. */
export const TEST_API = 'http://api.test';

export const TEST_TRACE_ID = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

export const apiUrl = (path: string): string => `${TEST_API}${path}`;

/** An `application/problem+json` response with `x-trace-id`. */
export function problemResponse(
  status: number,
  problem: Partial<Problem> = {},
  headers: Record<string, string> = {},
): Response {
  const body: Problem = {
    type: 'urn:tim:problem:internal',
    title: 'Problem',
    status,
    detail: 'Something went wrong',
    traceId: TEST_TRACE_ID,
    errors: null,
    ...problem,
  };
  return HttpResponse.json(body, {
    status,
    headers: { 'Content-Type': 'application/problem+json', 'x-trace-id': body.traceId, ...headers },
  });
}

/** A `KustoQueryRun` fixture. */
export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    kustoQuery: {
      cluster: 'https://contoso.westus2.kusto.windows.net',
      database: 'Db',
      query: 'T | take 1',
      requestedBy: 'alice',
    },
    executeDateTimeUtc: '2026-03-14T09:31:02.114Z',
    queryRunId: 'c1b7f1f6-9a34-4a52-8c1e-5f2e0f7b2a90',
    status: 'created',
    resultData: null,
    executionMetrics: null,
    mainError: null,
    expiresAt: '2026-03-15T09:31:02.114Z',
    ...overrides,
  };
}

const runResponse = (run: Run, status: 200 | 202 = run.status === 'created' ? 202 : 200) =>
  HttpResponse.json(run, { status, headers: { 'x-trace-id': TEST_TRACE_ID } });

/**
 * Handlers for `POST /api/kusto/query` and `GET /api/kusto/query/:id`: the POST returns
 * `first`, then each GET returns the next of `polls` (the last repeats).
 */
export function queryRunHandlers(first: Run, polls: Run[] = []): HttpHandler[] {
  let i = 0;
  return [
    http.post(apiUrl('/api/kusto/query'), () => runResponse(first)),
    http.get(apiUrl('/api/kusto/query/:id'), () => {
      const run = polls[Math.min(i++, polls.length - 1)] ?? first;
      return runResponse(run);
    }),
  ];
}
