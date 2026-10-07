import type { Page, Route } from '@playwright/test';
import { executionMetrics, kustoSchema, rows, templates, type MockRow } from './data';

/** Every API call the app made, for assertions. */
interface ApiCall {
  method: string;
  path: string;
  search: string;
  body: unknown;
  authorization: string | undefined;
}

export interface ApiMockOptions {
  templates?: readonly object[];
  rows?: readonly MockRow[];
  /** Polls answered 202 before a run completes (0 = POST answers 200 directly). */
  pendingPolls?: number;
  /** Per-test route overrides, tried before the defaults. Return true when handled. */
  handlers?: readonly ApiHandler[];
}

export type ApiHandler = (route: Route, call: ApiCall) => boolean | Promise<boolean>;

export interface ApiMock {
  calls: ApiCall[];
  /** Calls whose method and path match. */
  callsTo: (method: string, path: string | RegExp) => ApiCall[];
}

const RUN_ID = 'c1b7f1f6-9a34-4a52-8c1e-5f2e0f7b2a90';

export const json = (route: Route, body: unknown, status = 200): Promise<void> =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export const problem = (
  route: Route,
  status: number,
  type: string,
  detail: string,
): Promise<void> =>
  route.fulfill({
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify({
      type: `urn:tim:problem:${type}`,
      title: type,
      status,
      detail,
      traceId: 'e2e',
    }),
  });

/**
 * Intercepts every `/api/**` request (no real api needed). Query runs follow the contract:
 * POST -> 202 `created` (or 200 when `pendingPolls` is 0), GET poll -> 202 ... -> 200 `completed`.
 */
export async function mockApi(page: Page, options: ApiMockOptions = {}): Promise<ApiMock> {
  const calls: ApiCall[] = [];
  const data = options.rows ?? rows;
  const tpls = options.templates ?? templates;
  const pendingPolls = options.pendingPolls ?? 1;
  const polls = new Map<string, number>();

  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const call: ApiCall = {
        method: req.method(),
        path: url.pathname,
        search: url.search,
        body: req.postData() ? (JSON.parse(req.postData() ?? 'null') as unknown) : null,
        authorization: req.headers()['authorization'],
      };
      calls.push(call);
      for (const handler of options.handlers ?? []) {
        if (await handler(route, call)) return;
      }
      const { method, path } = call;
      const run = (status: string) => ({
        kustoQuery: call.body ?? {},
        executeDateTimeUtc: '2026-09-29T10:00:00.000Z',
        queryRunId: RUN_ID,
        status,
        resultData: status === 'completed' ? data : null,
        executionMetrics: status === 'completed' ? executionMetrics : null,
        mainError: null,
        expiresAt: '2026-09-30T10:00:00.000Z',
      });

      if (path === '/api/templates/queries' && method === 'GET') return json(route, tpls);
      if (path.startsWith('/api/templates/queries/') && method === 'GET') {
        const found = (tpls as { uuid: string }[]).find((t) => path.endsWith(t.uuid));
        return found ? json(route, found) : problem(route, 404, 'not-found', 'Not found');
      }
      if (path === '/api/kusto/schema' && method === 'POST') return json(route, kustoSchema);
      if (path === '/api/kusto/query' && method === 'POST') {
        polls.set(RUN_ID, 0);
        return pendingPolls === 0
          ? json(route, run('completed'))
          : json(route, run('created'), 202);
      }
      if (path.startsWith('/api/kusto/query/') && method === 'GET') {
        const n = (polls.get(RUN_ID) ?? 0) + 1;
        polls.set(RUN_ID, n);
        return n > pendingPolls ? json(route, run('completed')) : json(route, run('created'), 202);
      }
      if (path.startsWith('/api/taggedevents/') && method === 'POST') {
        return route.fulfill({ status: 204 });
      }
      return problem(route, 404, 'not-found', `e2e: no mock for ${method} ${path}`);
    },
  );

  return {
    calls,
    callsTo: (method, path) =>
      calls.filter(
        (c) =>
          c.method === method && (typeof path === 'string' ? c.path === path : path.test(c.path)),
      ),
  };
}
