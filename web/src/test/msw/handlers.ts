import { HttpResponse } from 'msw';
import type { components } from '../../lib/api/schema';

type Problem = components['schemas']['ProblemDetails'];

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
