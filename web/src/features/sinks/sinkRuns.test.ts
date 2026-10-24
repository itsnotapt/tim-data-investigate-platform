import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotifyOptions } from '../../components/notifyContext';
import type { Run, SinkInput } from '../../lib/api';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { resumeSinkRuns, runSink, type SinkRunOptions } from './sinkRuns';

const server = setupMswServer();
const RUN_ID = '7c1d6e0f-2a8f-4b9e-8e66-3a2d3b4c5d6e';
const SAVE = { key: 'dev-save', name: 'Save event' };
const INPUT: SinkInput = {
  columns: [{ name: 'Host', type: 'string' }],
  rows: [{ Host: 'h-1' }, { Host: 'h-2' }],
};

const makeRun = (overrides: Partial<Run> = {}): Run => ({
  runId: RUN_ID,
  status: 'running',
  action: SAVE,
  params: {},
  owner: 'jo@example.com',
  startedAt: '2026-10-23T10:00:00Z',
  expiresAt: '2026-10-24T10:00:00Z',
  details: {},
  ...overrides,
});
const ended = (overrides: Partial<Run>) =>
  makeRun({ finishedAt: '2026-10-23T10:00:02Z', ...overrides });

/** Answers each poll with the next run; the last repeats. */
const pollHandler = (...runs: Run[]) => {
  let i = 0;
  return http.get(apiUrl(`/api/runs/${RUN_ID}`), () =>
    HttpResponse.json(runs[Math.min(i++, runs.length - 1)]),
  );
};

/** A storage of its own per test. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => void items.delete(k),
    setItem: (k, v) => void items.set(k, v),
  };
}

let toasts: NotifyOptions[];
let delays: number[];
let options: SinkRunOptions;

beforeEach(() => {
  configureTestApp();
  toasts = [];
  delays = [];
  options = {
    notify: (o) => toasts.push(typeof o === 'string' ? { message: o } : o),
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
    storage: memoryStorage(),
  };
});
afterEach(resetTestApp);

describe('runSink', () => {
  it('sends the rows to the sink, follows the run and toasts how many it took', async () => {
    let body: unknown;
    server.use(
      http.post(apiUrl('/api/runs'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeRun());
      }),
      pollHandler(
        makeRun(),
        ended({ status: 'succeeded', details: { duration: 'PT2S', inputRowCount: 2 } }),
      ),
    );
    await runSink(SAVE, INPUT, options);
    expect(body).toEqual({ action: 'dev-save', params: {}, input: INPUT });
    expect(delays).toEqual([1000, 1000]);
    expect(toasts.map((t) => t.message)).toEqual(['Save event: 2 rows']);
    expect(toasts[0]?.action).toBeUndefined();
  });

  it('toasts a failed run with Retry, which sends the same rows again', async () => {
    const bodies: unknown[] = [];
    let runs = 0;
    server.use(
      http.post(apiUrl('/api/runs'), async ({ request }) => {
        bodies.push(await request.json());
        runs += 1;
        return HttpResponse.json(
          runs === 1
            ? ended({ status: 'error', error: 'Kusto refused the ingestion' })
            : ended({ status: 'succeeded', details: { inputRowCount: 2 } }),
        );
      }),
    );
    await runSink(SAVE, INPUT, options);
    expect(toasts.map((t) => t.message)).toEqual(['Save event: Kusto refused the ingestion']);
    const retry = toasts[0]?.action;
    expect(retry?.label).toBe('Retry');
    retry?.onClick();
    await expect.poll(() => toasts.length).toBe(2);
    expect(toasts[1]?.message).toBe('Save event: 2 rows');
    expect(bodies).toEqual([bodies[0], bodies[0]]);
    expect(bodies[0]).toMatchObject({ input: INPUT });
  });

  it.each([
    [
      'too large for the server',
      () => problemResponse(413, { title: 'Payload Too Large', detail: 'Payload Too Large' }),
      'Save event: Too much to send; select fewer rows',
      false,
    ],
    [
      'refused',
      () => problemResponse(422, { errors: { 'input.rows': ['At most 1 rows; 2 given'] } }),
      "Save event: Couldn't start: At most 1 rows; 2 given",
      false,
    ],
    ['unreachable', () => HttpResponse.error(), /^Save event: Couldn't start: /, true],
  ])('says why a run it could not start was %s', async (_, response, message, retry) => {
    server.use(http.post(apiUrl('/api/runs'), response));
    await runSink(SAVE, INPUT, options);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toMatch(message);
    expect(toasts[0]?.action?.label).toBe(retry ? 'Retry' : undefined);
  });

  it.each([
    ['gone', () => problemResponse(404), 'Save event: The run is no longer available'],
    ['unreachable', () => HttpResponse.error(), /^Save event: Lost track of the run: /],
  ])('says so, once and without Retry, when the run is %s', async (_, response, message) => {
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(makeRun())),
      http.get(apiUrl(`/api/runs/${RUN_ID}`), response),
    );
    await runSink(SAVE, INPUT, options);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toMatch(message);
    expect(toasts[0]?.action).toBeUndefined();
    await resumeSinkRuns(options);
    expect(toasts).toHaveLength(1);
  });
});

describe('resumeSinkRuns', () => {
  it('after a reload, shows the result of a run that was going, once and without Retry', async () => {
    let polls = 0;
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(makeRun())),
      http.get(apiUrl(`/api/runs/${RUN_ID}`), () => {
        polls += 1;
        return HttpResponse.json(
          polls === 1 ? makeRun() : ended({ status: 'succeeded', details: { inputRowCount: 2 } }),
        );
      }),
    );
    let waiting = false;
    // The page is reloaded while the run waits for its first poll.
    void runSink(SAVE, INPUT, {
      ...options,
      sleep: () => {
        waiting = true;
        return new Promise<void>(() => undefined);
      },
    });
    await expect.poll(() => waiting).toBe(true);
    // Followed already on this page.
    await resumeSinkRuns(options);
    expect(polls).toBe(0);

    vi.resetModules();
    const reloaded = await import('./sinkRuns');
    await reloaded.resumeSinkRuns(options);
    expect(toasts).toEqual([{ message: 'Save event: 2 rows' }]);
    await reloaded.resumeSinkRuns(options);
    vi.resetModules();
    await (await import('./sinkRuns')).resumeSinkRuns(options);
    expect(toasts).toHaveLength(1);
  });

  it('after a reload, shows a failed run without Retry, as its rows are gone', async () => {
    server.use(
      http.post(apiUrl('/api/runs'), () => HttpResponse.json(makeRun())),
      pollHandler(makeRun(), ended({ status: 'error', error: 'Kusto refused the ingestion' })),
    );
    let waiting = false;
    void runSink(SAVE, INPUT, {
      ...options,
      sleep: () => {
        waiting = true;
        return new Promise<void>(() => undefined);
      },
    });
    await expect.poll(() => waiting).toBe(true);
    vi.resetModules();
    await (await import('./sinkRuns')).resumeSinkRuns(options);
    expect(toasts).toEqual([{ message: 'Save event: Kusto refused the ingestion' }]);
  });
});
