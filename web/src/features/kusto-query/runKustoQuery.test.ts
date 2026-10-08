import 'fake-indexeddb/auto';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rowResultsDao } from '../../lib/storage';
import {
  apiUrl,
  makeRun,
  problemResponse,
  queryRunHandlers,
  TEST_API,
} from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { newTestStore, kusto } from '../../test/tabsTestUtils';
import { relativeRange } from '../../lib/time-range';
import { runKustoQuery } from './runKustoQuery';

vi.mock('../../lib/api/client', async (orig) => {
  const m = await orig<typeof import('../../lib/api/client')>();
  return {
    ...m,
    getApiClient: () =>
      m.createApiClient({ baseUrl: TEST_API, getToken: () => Promise.resolve('t'), timeoutMs: 0 }),
  };
});

const server = setupMswServer();
const store = newTestStore();
const range = relativeRange({ amount: 15, unit: 'minutes' });
const stats = {
  execution_time: 0.25,
  resource_usage: { cpu: { 'total cpu': '00:00:01.5' }, memory: { peak_per_node: 52428800 } },
};

beforeEach(() => {
  store.reset();
  store.getState().createTab(
    kusto('a', null, {
      params: { query: 'T | take 2', cluster: 'contoso', database: 'Db' },
    }),
  );
});

const tab = () => store.getState().tabs['a']!;

describe('runKustoQuery', () => {
  it('stores rows, stats and rowCount, marks unvisited and triggers row data', async () => {
    store.getState().markVisited('a');
    let body: Record<string, unknown> = {};
    server.use(
      http.post(apiUrl('/api/kusto/query'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          makeRun({
            status: 'completed',
            resultData: [{ a: 1 }, { a: 2 }],
            executionMetrics: stats,
          }),
        );
      }),
    );
    const running = runKustoQuery('a', range, { store });
    expect(tab().state.isExecuting).toBe(true);
    await running;
    expect(body).toMatchObject({
      cluster: 'https://contoso',
      database: 'Db',
      query: 'T | take 2',
    });
    expect(Date.parse(body['endTime'] as string) - Date.parse(body['startTime'] as string)).toBe(
      15 * 60_000,
    );
    expect(tab().state).toMatchObject({
      isExecuting: false,
      isVisited: false,
      error: null,
      rowCount: 2,
      executionTime: 0.25,
      cpuUsage: '00:00:01.5',
      memoryUsage: '52428800',
    });
    expect(tab().rowDataTrigger).not.toBeNull();
    expect(await rowResultsDao.get('a')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('stores a serialisable error and deletes rows', async () => {
    await rowResultsDao.put('a', [{ old: 1 }]);
    server.use(...queryRunHandlers(makeRun({ status: 'error', mainError: 'Semantic error' })));
    await runKustoQuery('a', range, { store });
    expect(tab().state).toMatchObject({ isExecuting: false, error: { message: 'Semantic error' } });
    expect(() => structuredClone(tab().state)).not.toThrow();
    expect(tab().rowDataTrigger).not.toBeNull();
    expect(await rowResultsDao.get('a')).toEqual([]);
  });

  it('stores API problems as an error', async () => {
    server.use(
      http.post(apiUrl('/api/kusto/query'), () =>
        problemResponse(400, { detail: 'Cluster not allowed' }),
      ),
    );
    await runKustoQuery('a', range, { store });
    expect(tab().state.error?.message).toBe('Cluster not allowed');
  });

  it('stores the cluster rejection reason when the server gives one', async () => {
    server.use(
      http.post(apiUrl('/api/kusto/query'), () =>
        problemResponse(400, {
          type: 'urn:tim:problem:cluster-not-allowed',
          detail: 'The cluster is not allowed',
          errors: { cluster: ['Invalid cluster URL: host is not in the allowed cluster list.'] },
        }),
      ),
    );
    await runKustoQuery('a', range, { store });
    expect(tab().state.error?.message).toBe(
      'Invalid cluster URL: host is not in the allowed cluster list.',
    );
  });

  it('aborts and writes nothing when the tab is removed', async () => {
    let aborted = false;
    server.use(
      http.post(apiUrl('/api/kusto/query'), async ({ request }) => {
        request.signal.addEventListener('abort', () => (aborted = true));
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json(
          makeRun({ status: 'completed', resultData: [{ a: 1 }], executionMetrics: stats }),
        );
      }),
    );
    const running = runKustoQuery('a', range, { store });
    await new Promise((r) => setTimeout(r, 20));
    await store.getState().removeTab('a');
    await running;
    expect(aborted).toBe(true);
    expect(store.getState().tabs['a']).toBeUndefined();
    expect(await rowResultsDao.get('a')).toEqual([]);
  });

  it('a newer run supersedes an older one on the same tab', async () => {
    let n = 0;
    server.use(
      http.post(apiUrl('/api/kusto/query'), async () => {
        const i = ++n;
        if (i === 1) await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json(
          makeRun({ status: 'completed', resultData: [{ run: i }], executionMetrics: stats }),
        );
      }),
    );
    const first = runKustoQuery('a', range, { store });
    await new Promise((r) => setTimeout(r, 10));
    await runKustoQuery('a', range, { store });
    await first;
    expect(await rowResultsDao.get('a')).toEqual([{ run: 2 }]);
  });
});
