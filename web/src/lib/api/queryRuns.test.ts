import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiUrl,
  makeRun,
  problemResponse,
  queryRunHandlers,
  TEST_API,
} from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { createApiClient } from './client';
import { ApiError } from './errors';
import {
  formatCluster,
  handleResult,
  pollDelay,
  POLL_MAX_TOTAL_MS,
  QueryRunError,
  QueryTimeoutError,
  runQuery,
} from './queryRuns';

const server = setupMswServer();
const realSetTimeout = globalThis.setTimeout;
/** Lets MSW deliver in-flight mocked responses; fake timers do not advance it. */
async function flushNetwork(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => realSetTimeout(resolve, 10));
    await vi.advanceTimersByTimeAsync(1);
  }
}
const client = createApiClient({
  baseUrl: TEST_API,
  getToken: () => Promise.resolve('t'),
  timeoutMs: 0,
});
const request = { cluster: 'contoso.westus2', database: 'Db', query: 'T | take 1' };
const stats = { execution_time: 0.5 };
const done = makeRun({ status: 'completed', resultData: [{ a: 1 }], executionMetrics: stats });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pollDelay', () => {
  it('starts at 500 ms, doubles every 3 polls, caps at 30 s', () => {
    expect([0, 1, 2, 3, 5, 6, 9].map(pollDelay)).toEqual([500, 500, 500, 1000, 1000, 2000, 4000]);
    expect(pollDelay(3 * 10)).toBe(30_000);
    expect(pollDelay(1000)).toBe(30_000);
  });
});

describe('runQuery', () => {
  it('returns rows and stats for an immediate 200', async () => {
    server.use(...queryRunHandlers(done));
    await expect(runQuery(request, { client })).resolves.toEqual({
      rows: [{ a: 1 }],
      stats,
    });
  });

  it('normalises the cluster and never sends requestedBy', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(apiUrl('/api/kusto/query'), async ({ request: r }) => {
        body = (await r.json()) as Record<string, unknown>;
        return HttpResponse.json(done);
      }),
    );
    await runQuery({ ...request, requestedBy: 'mallory' } as never, { client });
    expect(body['cluster']).toBe('https://contoso.westus2');
    expect(body).not.toHaveProperty('requestedBy');
  });

  it('202 then 200 polls with backoff', async () => {
    let gets = 0;
    server.use(
      http.post(apiUrl('/api/kusto/query'), () => HttpResponse.json(makeRun(), { status: 202 })),
      http.get(apiUrl('/api/kusto/query/:id'), () => {
        gets++;
        return gets < 3 ? HttpResponse.json(makeRun(), { status: 202 }) : HttpResponse.json(done);
      }),
    );
    const onPoll = vi.fn();
    const p = runQuery(request, { client, onPoll });
    await flushNetwork(); // the POST answers 202 and the first poll delay starts
    await vi.advanceTimersByTimeAsync(400);
    expect(gets).toBe(0);
    await vi.advanceTimersByTimeAsync(150);
    await flushNetwork();
    expect(gets).toBe(1);
    expect(onPoll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(400);
    expect(gets).toBe(1);
    await vi.advanceTimersByTimeAsync(150);
    await flushNetwork();
    expect(gets).toBe(2);
    await vi.advanceTimersByTimeAsync(600);
    await flushNetwork();
    await expect(p).resolves.toEqual({ rows: [{ a: 1 }], stats });
    expect(gets).toBe(3);
    expect(onPoll).toHaveBeenCalledTimes(3);
  });

  it('throws QueryRunError with mainError for status error', async () => {
    server.use(
      ...queryRunHandlers(makeRun(), [makeRun({ status: 'error', mainError: 'Syntax error' })]),
    );
    const p = runQuery(request, { client }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(500);
    const err = await p;
    expect(err).toBeInstanceOf(QueryRunError);
    expect((err as Error).message).toBe('Syntax error');
  });

  it('throws a server-source QueryTimeoutError for status timedOut', async () => {
    server.use(...queryRunHandlers(makeRun({ status: 'timedOut', mainError: 'Took too long' })));
    const err = await runQuery(request, { client }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QueryTimeoutError);
    expect(err).toMatchObject({ source: 'server', message: 'Took too long' });
  });

  it('gives up after 11 minutes with a client-source QueryTimeoutError', async () => {
    let gets = 0;
    server.use(
      http.post(apiUrl('/api/kusto/query'), () => HttpResponse.json(makeRun(), { status: 202 })),
      http.get(apiUrl('/api/kusto/query/:id'), () => {
        gets++;
        return HttpResponse.json(makeRun(), { status: 202 });
      }),
    );
    const p = runQuery(request, { client }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(POLL_MAX_TOTAL_MS + 1000);
    const err = await p;
    expect(err).toBeInstanceOf(QueryTimeoutError);
    expect(err).toMatchObject({ source: 'client' });
    expect(gets).toBeGreaterThan(10);
    const seen = gets;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(gets).toBe(seen); // stopped polling
  });

  it('aborts while waiting between polls and stops polling', async () => {
    let gets = 0;
    server.use(
      http.post(apiUrl('/api/kusto/query'), () => HttpResponse.json(makeRun(), { status: 202 })),
      http.get(apiUrl('/api/kusto/query/:id'), () => {
        gets++;
        return HttpResponse.json(makeRun(), { status: 202 });
      }),
    );
    const ac = new AbortController();
    const p = runQuery(request, { client, signal: ac.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(600);
    expect(gets).toBe(1);
    ac.abort();
    await expect(p).resolves.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(gets).toBe(1);
  });

  it('rejects at once for an already-aborted signal', async () => {
    const ac = new AbortController();
    ac.abort();
    server.use(...queryRunHandlers(done));
    await expect(runQuery(request, { client, signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('surfaces HTTP errors from the POST as ApiError', async () => {
    server.use(
      http.post(apiUrl('/api/kusto/query'), () =>
        problemResponse(400, { type: 'urn:tim:problem:cluster-not-allowed', detail: 'nope' }),
      ),
    );
    const err = await runQuery(request, { client }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ type: 'urn:tim:problem:cluster-not-allowed' });
  });
});

describe('handleResult', () => {
  it('defaults missing rows and stats', () => {
    expect(handleResult(makeRun({ status: 'completed' }))).toEqual({ rows: [], stats: null });
  });
  it('rejects a non-final run', () => {
    expect(() => handleResult(makeRun())).toThrow(/Unexpected query run status/);
  });
});

describe('formatCluster', () => {
  it.each([
    ['contoso.westus2', 'https://contoso.westus2'],
    ['', ''],
    ['contoso.westus2.kusto.windows.net', 'https://contoso.westus2.kusto.windows.net'],
    ['https://help.kusto.windows.net/', 'https://help.kusto.windows.net'],
    ['x.kusto.fabric.microsoft.com', 'https://x.kusto.fabric.microsoft.com'],
  ])('%s', (input, expected) => {
    expect(formatCluster(input)).toBe(expected);
  });
});

describe('runQuery start response', () => {
  it('rejects when a 202 response has no queryRunId', async () => {
    server.use(
      http.post(apiUrl('/api/kusto/query'), () =>
        HttpResponse.json({ ...makeRun(), queryRunId: undefined }, { status: 202 }),
      ),
    );
    await expect(runQuery(request, { client })).rejects.toThrow(
      'queryRunId missing from response.',
    );
  });
});
