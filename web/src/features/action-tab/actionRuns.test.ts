import 'fake-indexeddb/auto';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Run, RunRow } from '../../lib/api';
import { rowResultsDao } from '../../lib/storage';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { newTestStore } from '../../test/tabsTestUtils';
import { createTabsStore, type Tab, type TabState } from '../tabs';
import { resumeActionRuns, runActionTab } from './actionRuns';

const server = setupMswServer();
const store = newTestStore();
const RUN_ID = '5b0c5d0e-1f7e-4a8e-9d55-2f1c2f3a4b5c';

const makeRun = (overrides: Partial<Run> = {}): Run => ({
  runId: RUN_ID,
  status: 'running',
  action: { key: 'dev-sign-ins', name: 'Sign-ins' },
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
    columns: [{ name: 'User', type: 'string', declared: true }],
  });
const rows: RunRow[] = [
  { row: 0, id: 'c-1', data: { User: 'alice' } },
  { row: 1, id: 'c-2', data: { User: 'bob' } },
  { row: 2, id: null, data: { User: 'carol' } },
];

/** Rows at most two per page, as a server with a small `rowsPageSize`. */
const rowsHandler = (pages: string[] = []) =>
  http.get(apiUrl(`/api/runs/${RUN_ID}/rows`), ({ request }) => {
    const url = new URL(request.url);
    pages.push(url.search);
    const start = Number(url.searchParams.get('startRow'));
    const end = Math.min(Number(url.searchParams.get('endRow')), start + 2);
    return HttpResponse.json({ rows: rows.slice(start, end), lastRow: rows.length });
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

function createActionTab(uuid: string, state: Partial<TabState> = {}) {
  store.getState().createTab({
    componentName: 'ActionResult',
    componentUuid: uuid,
    parentUuid: null,
    title: 'Sign-ins',
    params: { action: 'dev-sign-ins', params: { users: ['alice'] } },
    state,
  });
}
const tab = (uuid = 'a') => store.getState().tabs[uuid]!;

beforeEach(async () => {
  configureTestApp();
  store.reset();
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
    expect(tab().state.isExecuting).toBe(true);
    await running;
    expect(body).toEqual({ action: 'dev-sign-ins', params: { users: ['alice'] } });
    expect(pages).toEqual(['?startRow=0&endRow=3', '?startRow=2&endRow=3']);
    expect(await rowResultsDao.get('a')).toEqual(rows);
    expect(tab().state).toMatchObject({
      isExecuting: false,
      error: null,
      rowCount: 3,
      resultsRunId: RUN_ID,
      resultColumns: [{ name: 'User', type: 'string', declared: true }],
      run: { runId: RUN_ID, status: 'succeeded' },
    });
    expect(tab().rowDataTrigger).not.toBeNull();
  });

  it('counts only the rows it stored when the server runs out of rows early', async () => {
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(succeeded(5))),
      rowsHandler(),
    );
    await runActionTab('a', { store, sleep });
    expect(await rowResultsDao.get('a')).toEqual(rows);
    expect(tab().state.rowCount).toBe(3);
  });

  it('polls every second for ten seconds, then every three, until the run ends', async () => {
    const running = Array.from({ length: 12 }, () => makeRun());
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(makeRun(), { status: 202 })),
      pollHandler(...running, succeeded(0)),
    );
    await runActionTab('a', { store, sleep });
    expect(delays).toEqual([...Array<number>(10).fill(1000), 3000, 3000, 3000]);
    expect(tab().state).toMatchObject({ isExecuting: false, rowCount: 0, error: null });
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
        seen = tab().state.run;
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
        save: (t) => Promise.resolve(void saved.set(t.componentUuid, t)),
        remove: () => Promise.resolve(),
      },
    });
    slow.getState().createTab({
      componentName: 'ActionResult',
      componentUuid: 'a',
      parentUuid: null,
      title: 'Sign-ins',
      params: { action: 'dev-sign-ins', params: {} },
    });
    let savedWhileRunning: Run | null | undefined;
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(makeRun(), { status: 202 })),
      pollHandler(succeeded(3)),
      rowsHandler(),
    );
    await runActionTab('a', {
      store: slow,
      sleep: () => Promise.resolve(void (savedWhileRunning = saved.get('a')?.state.run)),
    });
    expect(savedWhileRunning).toMatchObject({ runId: RUN_ID, status: 'running' });
    expect(saved.get('a')?.state).toMatchObject({ resultsRunId: RUN_ID, rowCount: 3 });
  });

  it('shows why a run could not start, naming the param', async () => {
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
    expect(tab().state).toMatchObject({
      isExecuting: false,
      error: { message: "Couldn't start: users: Value 1: Must be a string" },
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
    expect(tab().state).toMatchObject({ isExecuting: false, error: { message } });
    expect(tab().state.run?.status).toBe(ended.status);
  });

  it('says to run again when the results are gone', async () => {
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(succeeded(3))),
      http.get(apiUrl(`/api/runs/${RUN_ID}/rows`), () =>
        problemResponse(410, { type: 'urn:tim:problem:results-gone', title: 'Results gone' }),
      ),
    );
    await runActionTab('a', { store, sleep });
    expect(tab().state).toMatchObject({
      isExecuting: false,
      error: { message: 'Results are no longer available; run again' },
    });
  });
});

describe('resumeActionRuns', () => {
  it('picks up a running run by its id, and the rows of a run that ended meanwhile', async () => {
    createActionTab('b', { isExecuting: true, run: makeRun() });
    server.use(pollHandler(makeRun(), succeeded(3)), rowsHandler());
    await resumeActionRuns({ store, sleep });
    expect(await rowResultsDao.get('b')).toEqual(rows);
    expect(store.getState().tabs['b']!.state).toMatchObject({
      isExecuting: false,
      rowCount: 3,
      resultsRunId: RUN_ID,
    });
  });

  it('loads the rows of a succeeded run that were not stored yet', async () => {
    createActionTab('b', { isExecuting: true, run: succeeded(3) });
    server.use(rowsHandler());
    await resumeActionRuns({ store, sleep });
    expect(await rowResultsDao.get('b')).toEqual(rows);
  });

  it('leaves a tab whose rows are stored alone, even once its run has expired', async () => {
    createActionTab('b', { run: succeeded(3), resultsRunId: RUN_ID, rowCount: 3 });
    // Any request fails the test: the server has no handlers.
    await resumeActionRuns({ store, sleep });
    expect(store.getState().tabs['b']!.state).toMatchObject({ rowCount: 3, error: null });
  });

  it('stops showing a run going when the reload came before the run had an id', async () => {
    createActionTab('b', { isExecuting: true, run: null });
    createActionTab('c', { isExecuting: true, run: succeeded(3), resultsRunId: RUN_ID });
    await resumeActionRuns({ store, sleep });
    expect(store.getState().tabs['b']!.state.isExecuting).toBe(false);
    expect(store.getState().tabs['c']!.state.isExecuting).toBe(false);
  });

  it('says so when the run being picked up has expired', async () => {
    createActionTab('b', { isExecuting: true, run: makeRun() });
    server.use(
      http.get(apiUrl(`/api/runs/${RUN_ID}`), () =>
        problemResponse(404, { type: 'urn:tim:problem:not-found', detail: 'Run not found' }),
      ),
    );
    await resumeActionRuns({ store, sleep });
    expect(store.getState().tabs['b']!.state).toMatchObject({
      isExecuting: false,
      error: { message: 'The run is no longer available; run again' },
    });
  });
});
