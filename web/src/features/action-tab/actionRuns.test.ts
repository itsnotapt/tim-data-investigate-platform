import 'fake-indexeddb/auto';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run, RunRow } from '../../lib/api';
import { rowResultsDao } from '../../lib/storage';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { newTestStore, tab as newTab, type ContentOverrides } from '../../test/tabsTestUtils';
import { useInstanceStore } from '../instance';
import { createTabsStore, type Tab } from '../tabs';
import { cancelActionTab, resumeActionRuns, runActionTab } from './actionRuns';
import { paramEdited } from './model';
import {
  clearResults,
  holdResults,
  resultsOf,
  setResultsInputs,
  subscribeResults,
} from './results';

const server = setupMswServer();
const store = newTestStore();
const RUN_ID = '5b0c5d0e-1f7e-4a8e-9d55-2f1c2f3a4b5c';

const makeRun = (overrides: Partial<Run> = {}): Run => ({
  runId: RUN_ID,
  status: 'running',
  action: { key: 'dev-sign-ins', name: 'Sign-ins' },
  title: 'Sign-ins alice',
  params: { users: ['alice'] },
  owner: 'jo@example.com',
  startedAt: '2026-10-20T10:00:00Z',
  expiresAt: '2026-10-21T10:00:00Z',
  details: {},
  ...overrides,
});
const succeeded = (rowCount: number) =>
  makeRun({
    status: 'succeeded',
    rowCount,
    finishedAt: '2026-10-20T10:00:02Z',
    columns: [{ name: 'User', type: 'string', declared: true, duplicates: 0 }],
  });
const rows: RunRow[] = [
  { row: 0, data: { User: 'alice' } },
  { row: 1, data: { User: 'bob' } },
  { row: 2, data: { User: 'carol' } },
];

/** Rows at most two per page, as a server with a small `rowsPageSize`. */
const rowsHandler = (pages: string[] = []) =>
  http.get(apiUrl(`/api/runs/${RUN_ID}/rows`), ({ request }) => {
    const url = new URL(request.url);
    pages.push(url.search);
    const start = Number(url.searchParams.get('startRow'));
    const end = Math.min(Number(url.searchParams.get('endRow')), start + 2);
    const page = rows.slice(start, end);
    return HttpResponse.json({
      rows: page,
      lastRow: rows.length,
      annotationVersion: 7,
    });
  });

/** Answers each poll with the next run; the last repeats. */
const pollHandler = (...runs: Run[]) => {
  let i = 0;
  return http.get(apiUrl(`/api/runs/${RUN_ID}`), () =>
    HttpResponse.json(runs[Math.min(i++, runs.length - 1)]),
  );
};

let delays: number[] = [];
const sleep = (ms: number) => {
  delays.push(ms);
  return Promise.resolve();
};

/** A root tab `id` of Sign-ins for alice, with `over` merged on. */
function createActionTab(id: string, over: ContentOverrides = {}) {
  store.getState().createTab(
    newTab(id, null, {
      ...over,
      title: 'Sign-ins',
      toRun: { action: 'dev-sign-ins', params: { users: ['alice'] }, ...over.toRun },
    }),
  );
}
const tab = (id = 'a') => store.getState().tabs[id]!;

beforeEach(async () => {
  configureTestApp();
  useInstanceStore.setState({
    instance: {
      version: 'v1',
      actions: [
        {
          key: 'dev-sign-ins',
          kind: 'query',
          actionFile: false,
          findPivotRows: false,
          name: 'Sign-ins',
          menuPath: [],
          connections: [],
          params: [
            { name: 'users', title: 'Users', kind: 'string', required: false, many: true },
            { name: 'query', title: 'Query', kind: 'kql', required: false, many: false },
            {
              name: 'parameters',
              title: 'Query parameters',
              kind: 'json',
              required: false,
              many: false,
            },
          ],
          pivot: null,
        },
      ],
      connections: [],
      labels: [],
      limits: {
        maxResultRows: 1,
        maxResultBytes: 1,
        maxPivotRows: 100,
        rowsPageSize: 10,
        runTimeoutSeconds: 600,
        maxAnnotationIds: 10_000,
        annotationPollSeconds: 30,
      },
    },
  });
  store.reset();
  clearResults();
  delays = [];
  await rowResultsDao.deleteMany(['a', 'b', 'c']);
  createActionTab('a');
});
afterEach(resetTestApp);

describe('runActionTab', () => {
  it('runs the tab’s action with its params and stores every page of rows', async () => {
    let body: unknown;
    const pages: string[] = [];
    server.use(
      http.post(apiUrl('/api/runs'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(succeeded(3));
      }),
      rowsHandler(pages),
    );
    const running = runActionTab('a', { store, sleep });
    expect(tab().status.executing).toBe(true);
    await running;
    expect(body).toEqual({ action: 'dev-sign-ins', params: { users: ['alice'] } });
    expect(pages).toEqual(['?startRow=0&endRow=3', '?startRow=2&endRow=3']);
    expect(await rowResultsDao.get('a')).toEqual(rows);
    expect(tab()).toMatchObject({
      status: { executing: false, error: null },
      results: {
        runId: RUN_ID,
        rowCount: 3,
        columns: [{ name: 'User', type: 'string', declared: true, duplicates: 0 }],
      },
      latest: { run: { runId: RUN_ID, status: 'succeeded' } },
    });
  });

  it('sends the action’s title template filled in, and not the rows the tab was pivoted from', async () => {
    const { instance } = useInstanceStore.getState();
    useInstanceStore.setState({
      instance: {
        ...instance!,
        actions: instance!.actions.map((a) => ({
          ...a,
          title: 'Sign-ins for {users} in {row.App}',
        })),
      },
    });
    let body: unknown;
    server.use(
      http.post(apiUrl('/api/runs'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(succeeded(3));
      }),
      rowsHandler([]),
    );
    createActionTab('b', { toRun: { pivotRows: [{ App: 'Teams' }] } });
    await runActionTab('b', { store, sleep });
    expect(body).toEqual({
      action: 'dev-sign-ins',
      params: { users: ['alice'] },
      title: 'Sign-ins for [alice] in Teams',
    });
  });

  it('fills in an unset param with its default, as the run gets it', async () => {
    const { instance } = useInstanceStore.getState();
    useInstanceStore.setState({
      instance: {
        ...instance!,
        actions: instance!.actions.map((a) => ({
          ...a,
          title: 'Sign-ins for {users}',
          params: a.params.map((p) => (p.name === 'users' ? { ...p, default: ['bob'] } : p)),
        })),
      },
    });
    let body: { title?: string } = {};
    server.use(
      http.post(apiUrl('/api/runs'), async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json(succeeded(0));
      }),
    );
    createActionTab('b', { toRun: { params: { users: [] } } });
    await runActionTab('b', { store, sleep });
    expect(body.title).toBe('Sign-ins for [bob]');
  });

  it('shows each page of rows as it arrives, before every page is stored', async () => {
    let releaseSecondPage = () => {};
    const secondPage = new Promise<void>((resolve) => (releaseSecondPage = resolve));
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(succeeded(3))),
      http.get(apiUrl(`/api/runs/${RUN_ID}/rows`), async ({ request }) => {
        const start = Number(new URL(request.url).searchParams.get('startRow'));
        if (start > 0) await secondPage;
        return HttpResponse.json({
          rows: rows.slice(start, start + 2),
          lastRow: rows.length,
          annotationVersion: 0,
        });
      }),
    );
    holdResults('a');
    const running = runActionTab('a', { store, sleep });
    await vi.waitFor(() => expect(resultsOf('a')?.rows).toHaveLength(2));
    expect(resultsOf('a')).toMatchObject({
      runId: RUN_ID,
      total: 3,
      done: false,
      columns: [{ name: 'User', type: 'string', declared: true, duplicates: 0 }],
    });
    expect(resultsOf('a')?.rows.flat()).toMatchObject(rows.slice(0, 2));
    expect(await rowResultsDao.get('a')).toEqual([]);
    releaseSecondPage();
    await running;
    expect(resultsOf('a')?.done).toBe(true);
    expect(resultsOf('a')?.rows.flat()).toMatchObject(rows);
    expect(await rowResultsDao.get('a')).toEqual(rows);
  });

  it('drops the rows shown so far when loading the rest fails, and shows the last succeeded run’s again', async () => {
    const previous: RunRow[] = [{ row: 0, data: { User: 'dave' } }];
    await rowResultsDao.put('a', previous);
    holdResults('a');
    setResultsInputs('a', {
      idColumn: null,
      stored: { runId: 'r0', columns: null, startedAt: '2026-10-19T10:00:00Z', rowCount: 1 },
    });
    await vi.waitFor(() => expect(resultsOf('a')?.runId).toBe('r0'));
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(succeeded(3))),
      http.get(apiUrl(`/api/runs/${RUN_ID}/rows`), ({ request }) => {
        const start = Number(new URL(request.url).searchParams.get('startRow'));
        if (start > 0) return problemResponse(410, { type: 'urn:tim:problem:results-gone' });
        return HttpResponse.json({
          rows: rows.slice(0, 2),
          lastRow: rows.length,
          annotationVersion: 0,
        });
      }),
    );
    const seen: (string | undefined)[] = [];
    const unsubscribe = subscribeResults('a', (_, results) => seen.push(results?.runId));
    await runActionTab('a', { store, sleep });
    unsubscribe();
    expect(seen).toContain(RUN_ID);
    await vi.waitFor(() => expect(resultsOf('a')?.runId).toBe('r0'));
    expect(resultsOf('a')?.rows.flat()).toMatchObject(previous);
    expect(tab().status.error).toEqual({ message: 'Results are no longer available; run again' });
  });

  it('fails the run when a page’s row numbers don’t continue the rows so far, and stores none', async () => {
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(succeeded(3))),
      http.get(apiUrl(`/api/runs/${RUN_ID}/rows`), () =>
        HttpResponse.json({
          rows: [rows[0], rows[2]],
          lastRow: rows.length,
          annotationVersion: 0,
        }),
      ),
    );
    holdResults('a');
    await runActionTab('a', { store, sleep });
    expect(tab().status.error).toEqual({ message: 'Expected row 1 next, got row 2' });
    expect(tab().results).toBeNull();
    expect(await rowResultsDao.get('a')).toEqual([]);
    expect(resultsOf('a')).toBeNull();
  });

  it('counts only the rows it stored when the server runs out of rows early', async () => {
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(succeeded(5))),
      rowsHandler(),
    );
    await runActionTab('a', { store, sleep });
    expect(await rowResultsDao.get('a')).toEqual(rows);
    expect(tab().results?.rowCount).toBe(3);
  });

  it('polls every second for ten seconds, then every three, until the run ends', async () => {
    const running = Array.from({ length: 12 }, () => makeRun());
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(makeRun(), { status: 202 })),
      pollHandler(...running, succeeded(0)),
    );
    await runActionTab('a', { store, sleep });
    expect(delays).toEqual([...Array<number>(10).fill(1000), 3000, 3000, 3000]);
    expect(tab()).toMatchObject({
      status: { executing: false, error: null },
      results: { rowCount: 0 },
    });
  });

  it('keeps the run on the tab while it runs, so a reload can pick it up', async () => {
    let seen: Run | null | undefined;
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(makeRun(), { status: 202 })),
      pollHandler(succeeded(0)),
    );
    await runActionTab('a', {
      store,
      sleep: (ms) => {
        seen = tab().latest.run;
        return sleep(ms);
      },
    });
    expect(seen).toMatchObject({ runId: RUN_ID, status: 'running' });
  });

  it('saves the run id at once, and the results as soon as they are stored', async () => {
    const saved = new Map<string, Tab>();
    const slow = createTabsStore({
      debounceMs: 60_000,
      persistence: {
        loadAll: () => Promise.resolve([]),
        save: (t) => Promise.resolve(void saved.set(t.id, t)),
        remove: () => Promise.resolve(),
      },
    });
    slow.getState().createTab(newTab('a', null, { toRun: { action: 'dev-sign-ins' } }));
    let savedWhileRunning: Run | null | undefined;
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(makeRun(), { status: 202 })),
      pollHandler(succeeded(3)),
      rowsHandler(),
    );
    await runActionTab('a', {
      store: slow,
      sleep: () => Promise.resolve(void (savedWhileRunning = saved.get('a')?.latest.run)),
    });
    expect(savedWhileRunning).toMatchObject({ runId: RUN_ID, status: 'running' });
    expect(saved.get('a')?.results).toMatchObject({ runId: RUN_ID, rowCount: 3 });
  });

  it('marks each invalid param with its reasons instead of showing an error', async () => {
    server.use(
      http.post(apiUrl('/api/runs'), () =>
        problemResponse(422, {
          type: 'urn:tim:problem:validation',
          title: 'Validation failed',
          detail: 'The request is not valid.',
          errors: { 'params.users': ['Value 1: Must be a string'] },
        }),
      ),
    );
    await runActionTab('a', { store, sleep });
    expect(tab().status).toMatchObject({
      executing: false,
      error: null,
      paramErrors: { users: 'Value 1: Must be a string' },
    });
  });

  it('keeps the latest run on the tab when the server refuses a param', async () => {
    createActionTab('b', { latest: { run: succeeded(3) } });
    server.use(
      http.post(apiUrl('/api/runs'), () =>
        problemResponse(422, {
          type: 'urn:tim:problem:validation',
          errors: { 'params.users': ['Required'] },
        }),
      ),
    );
    await runActionTab('b', { store, sleep });
    expect(tab('b').latest.run).toEqual(succeeded(3));
  });

  it('marks a refused query param, which the editor shows', async () => {
    server.use(
      http.post(apiUrl('/api/runs'), () =>
        problemResponse(422, {
          type: 'urn:tim:problem:validation',
          errors: { 'params.query': ['Not valid KQL'] },
        }),
      ),
    );
    await runActionTab('a', { store, sleep });
    expect(tab().status).toMatchObject({ error: null, paramErrors: { query: 'Not valid KQL' } });
  });

  it('marks a refused query parameter on its pill', async () => {
    createActionTab('b', {
      toRun: { params: { parameters: [{ name: 'Since', type: 'datetime', value: 'yesterday' }] } },
    });
    server.use(
      http.post(apiUrl('/api/runs'), () =>
        problemResponse(422, {
          type: 'urn:tim:problem:validation',
          errors: { 'params.parameters.Since': ['Must be an ISO 8601 datetime'] },
        }),
      ),
    );
    await runActionTab('b', { store, sleep });
    expect(tab('b').status).toMatchObject({
      error: null,
      paramErrors: { 'parameters.Since': 'Must be an ISO 8601 datetime' },
    });
  });

  it('shows a refused param the tab does not show as why the run could not start', async () => {
    server.use(
      http.post(apiUrl('/api/runs'), () =>
        problemResponse(422, {
          type: 'urn:tim:problem:validation',
          errors: { 'params.extra': ['Unknown param'], 'params.users': ['Required'] },
        }),
      ),
    );
    await runActionTab('a', { store, sleep });
    expect(tab().status).toMatchObject({
      error: { message: "Couldn't start: extra: Unknown param" },
      paramErrors: { users: 'Required' },
    });
  });

  it.each([
    [
      problemResponse(422, {
        type: 'urn:tim:problem:validation',
        detail: 'The request is not valid.',
        errors: { action: ['Unknown action'], 'params.users': ['Required'] },
      }),
      "Couldn't start: Unknown action",
    ],
    [
      problemResponse(502, { detail: 'No token for the connection' }),
      "Couldn't start: No token for the connection",
    ],
  ])('shows any other reason a run could not start %#', async (response, message) => {
    server.use(http.post(apiUrl('/api/runs'), () => response));
    await runActionTab('a', { store, sleep });
    expect(tab().status).toMatchObject({ executing: false, error: { message } });
  });

  it('clears the marks and the latest run when the next run starts', async () => {
    createActionTab('b', {
      latest: { run: makeRun({ status: 'error' }), title: 'Sign-ins bob' },
      status: { error: { message: 'Failed' }, paramErrors: { users: 'Required' }, linkedRow: 1 },
    });
    let release = () => {};
    const started = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.post(apiUrl('/api/runs'), async () => {
        await started;
        return HttpResponse.json(succeeded(0));
      }),
    );
    const running = runActionTab('b', { store, sleep });
    expect(tab('b')).toMatchObject({
      status: { executing: true, error: null, paramErrors: null, linkedRow: null },
      latest: { run: null, title: 'Sign-ins bob' },
    });
    release();
    await running;
  });

  it('keeps the params and title of the latest run and when the stored results’ run started', async () => {
    server.use(http.post(apiUrl('/api/runs'), () => HttpResponse.json(succeeded(0))));
    await runActionTab('a', { store, sleep });
    store.getState().apply('a', paramEdited('users', ['bob']));
    expect(tab()).toMatchObject({
      latest: { params: { users: ['alice'] }, title: 'Sign-ins alice' },
      results: { startedAt: '2026-10-20T10:00:00Z' },
    });
  });

  it.each([
    [
      makeRun({ status: 'error', error: 'The sign-in log is unavailable' }),
      'The sign-in log is unavailable',
    ],
    [makeRun({ status: 'timedOut' }), 'The run timed out'],
    [makeRun({ status: 'cancelled' }), 'The run was cancelled'],
  ])('shows a run that ended %#', async (ended, message) => {
    server.use(http.post(apiUrl('/api/runs'), () => HttpResponse.json(ended)));
    await runActionTab('a', { store, sleep });
    expect(tab().status).toMatchObject({ executing: false, error: { message } });
    expect(tab().latest.run?.status).toBe(ended.status);
  });

  it('says to run again when the results are gone', async () => {
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(succeeded(3))),
      http.get(apiUrl(`/api/runs/${RUN_ID}/rows`), () =>
        problemResponse(410, { type: 'urn:tim:problem:results-gone', title: 'Results gone' }),
      ),
    );
    await runActionTab('a', { store, sleep });
    expect(tab().status).toMatchObject({
      executing: false,
      error: { message: 'Results are no longer available; run again' },
    });
  });
});

/** A sleep that waits until `wake()`, or rejects when its signal aborts. */
function wakeableSleep() {
  const wakers: (() => void)[] = [];
  const sleep = (_ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      wakers.push(resolve);
      signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
    });
  return { sleep, wake: () => wakers.splice(0).forEach((w) => w()) };
}

describe('cancelActionTab', () => {
  it('shows the run cancelling until a poll finds it cancelled', async () => {
    let cancelled = false;
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(makeRun(), { status: 202 })),
      http.post(apiUrl(`/api/runs/${RUN_ID}/cancel`), () => {
        cancelled = true;
        return HttpResponse.json(makeRun());
      }),
      http.get(apiUrl(`/api/runs/${RUN_ID}`), () =>
        HttpResponse.json(makeRun({ status: cancelled ? 'cancelled' : 'running' })),
      ),
    );
    const { sleep, wake } = wakeableSleep();
    const running = runActionTab('a', { store, sleep });
    await vi.waitFor(() => expect(tab().latest.run?.runId).toBe(RUN_ID));
    await cancelActionTab('a', { store, sleep });
    expect(cancelled).toBe(true);
    expect(tab().status).toMatchObject({ executing: true, cancelling: true });
    wake();
    await running;
    expect(tab()).toMatchObject({
      status: { executing: false, cancelling: false, error: { message: 'The run was cancelled' } },
      latest: { run: { status: 'cancelled' } },
    });
  });

  it('ends the run at once when the server answers that it is cancelled', async () => {
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(makeRun(), { status: 202 })),
      http.post(apiUrl(`/api/runs/${RUN_ID}/cancel`), () =>
        HttpResponse.json(makeRun({ status: 'cancelled' })),
      ),
    );
    const { sleep } = wakeableSleep();
    const running = runActionTab('a', { store, sleep });
    await vi.waitFor(() => expect(tab().latest.run?.runId).toBe(RUN_ID));
    await cancelActionTab('a', { store, sleep });
    await running;
    expect(tab()).toMatchObject({
      status: { executing: false, cancelling: false, error: { message: 'The run was cancelled' } },
      latest: { run: { status: 'cancelled' } },
    });
  });

  it('shows why the cancel failed, and keeps following the run', async () => {
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(makeRun(), { status: 202 })),
      http.post(apiUrl(`/api/runs/${RUN_ID}/cancel`), () =>
        problemResponse(503, { title: 'Unavailable', detail: 'Try again' }),
      ),
      pollHandler(succeeded(0)),
    );
    const { sleep, wake } = wakeableSleep();
    const running = runActionTab('a', { store, sleep });
    await vi.waitFor(() => expect(tab().latest.run?.runId).toBe(RUN_ID));
    await cancelActionTab('a', { store, sleep });
    expect(tab().status).toMatchObject({
      executing: true,
      cancelling: false,
      error: { message: "Couldn't cancel: Try again" },
    });
    wake();
    await running;
    expect(tab()).toMatchObject({
      status: { executing: false, error: null },
      results: { rowCount: 0 },
    });
  });
});

describe('resumeActionRuns', () => {
  it('picks up a running run by its id, and the rows of a run that ended meanwhile', async () => {
    createActionTab('b', { status: { executing: true }, latest: { run: makeRun() } });
    server.use(pollHandler(makeRun(), succeeded(3)), rowsHandler());
    await resumeActionRuns({ store, sleep });
    expect(await rowResultsDao.get('b')).toEqual(rows);
    expect(tab('b')).toMatchObject({
      status: { executing: false },
      results: { rowCount: 3, runId: RUN_ID },
    });
  });

  it('loads the rows of a succeeded run that were not stored yet', async () => {
    createActionTab('b', { status: { executing: true }, latest: { run: succeeded(3) } });
    server.use(rowsHandler());
    await resumeActionRuns({ store, sleep });
    expect(await rowResultsDao.get('b')).toEqual(rows);
  });

  it('leaves a tab whose rows are stored alone, even once its run has expired', async () => {
    createActionTab('b', {
      latest: { run: succeeded(3) },
      results: { runId: RUN_ID, columns: null, startedAt: '2026-10-20T10:00:00Z', rowCount: 3 },
    });
    // Any request fails the test: the server has no handlers.
    await resumeActionRuns({ store, sleep });
    expect(tab('b')).toMatchObject({ status: { error: null }, results: { rowCount: 3 } });
  });

  it('stops showing a run going when the reload came before the run had an id', async () => {
    createActionTab('b', { status: { executing: true } });
    createActionTab('c', {
      status: { executing: true },
      latest: { run: succeeded(3) },
      results: { runId: RUN_ID, columns: null, startedAt: '2026-10-20T10:00:00Z', rowCount: 3 },
    });
    await resumeActionRuns({ store, sleep });
    expect(tab('b').status.executing).toBe(false);
    expect(tab('c').status.executing).toBe(false);
  });

  it.each([
    [1, 1],
    [7, null],
  ])('keeps a linked row %i only when the stored rows have it', async (linkedRow, kept) => {
    createActionTab('b', { status: { executing: true, linkedRow }, latest: { run: succeeded(3) } });
    server.use(rowsHandler());
    await resumeActionRuns({ store, sleep });
    expect(tab('b')).toMatchObject({ status: { linkedRow: kept }, results: { rowCount: 3 } });
  });

  it('drops the linked row of a run that ends without rows', async () => {
    createActionTab('b', { status: { executing: true, linkedRow: 1 }, latest: { run: makeRun() } });
    server.use(pollHandler(makeRun({ status: 'error', error: 'Failed' })));
    await resumeActionRuns({ store, sleep });
    expect(tab('b').status).toMatchObject({ error: { message: 'Failed' }, linkedRow: null });
  });

  it('says so when the run being picked up has expired', async () => {
    createActionTab('b', { status: { executing: true }, latest: { run: makeRun() } });
    server.use(
      http.get(apiUrl(`/api/runs/${RUN_ID}`), () =>
        problemResponse(404, { type: 'urn:tim:problem:not-found', detail: 'Run not found' }),
      ),
    );
    await resumeActionRuns({ store, sleep });
    expect(tab('b').status).toMatchObject({
      executing: false,
      error: { message: 'The run is no longer available; run again' },
    });
  });
});
