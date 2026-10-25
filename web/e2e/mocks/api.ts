import type { Page, Route } from '@playwright/test';

/** Every API call the app made, for assertions. */
interface ApiCall {
  method: string;
  path: string;
  search: string;
  body: unknown;
  authorization: string | undefined;
}

export interface ApiMockOptions {
  /** Per-test route overrides, tried before the defaults. Return true when handled. */
  handlers?: readonly ApiHandler[];
}

export type ApiHandler = (route: Route, call: ApiCall) => boolean | Promise<boolean>;

export interface ApiMock {
  calls: ApiCall[];
  /** Calls whose method and path match. */
  callsTo: (method: string, path: string | RegExp) => ApiCall[];
}

/** An instance with no actions: the mocked flows open no action. */
const instance = {
  version: 'e2e',
  actions: [],
  connections: [],
  labels: [],
  limits: {
    maxResultRows: 1000000,
    maxResultBytes: 536870912,
    rowsPageSize: 10000,
    runTimeoutSeconds: 600,
  },
};

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

/** Intercepts every `/api/**` request (no real api needed). */
export async function mockApi(page: Page, options: ApiMockOptions = {}): Promise<ApiMock> {
  const calls: ApiCall[] = [];

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
      if (path === '/api/instance' && method === 'GET') return json(route, instance);
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
