import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAnnotationStore } from '../../lib/annotations';
import type { RunColumn, RunRow } from '../../lib/api';
import { annotated } from '../../test/annotationFakes';
import { content } from '../../test/tabsTestUtils';
import { useTabsStore } from '../tabs/tabStore';
import { rowResultsDao, type TabResults } from '../../lib/storage';
import {
  clearResults,
  holdResults,
  loadAbandoned,
  pageLoaded,
  resultsOf,
  runLoaded,
  runLoading,
  setResultsInputs,
  subscribeResults,
  type ResultsChange,
  type ResultsInputs,
} from './results';

const columns: RunColumn[] = [{ name: 'User', type: 'string', declared: true }];
const row = (n: number, user: unknown): RunRow => ({ row: n, data: { User: user } });
const stored = (runId: string, rowCount: number): TabResults => ({
  runId,
  columns,
  startedAt: '2026-11-02T09:00:00Z',
  rowCount,
});

/** Loads `rows` as the tab's run `runId`, which succeeds: its rows are stored, as `followRun` does. */
async function succeeded(tabId: string, runId: string, rows: RunRow[]): Promise<void> {
  runLoading(tabId, { runId, columns, rowCount: rows.length }, 'User');
  pageLoaded(tabId, runId, rows);
  await rowResultsDao.put(tabId, rows);
  runLoaded(tabId, runId);
}

/** The changes the tab's Results tell, from now on. */
function changesOf(tabId: string): ResultsChange[] {
  const changes: ResultsChange[] = [];
  subscribeResults(tabId, (change) => changes.push(change));
  return changes;
}

beforeEach(() => useTabsStore.reset());
afterEach(() => clearResults());

/** Holds the tab's Results, given `inputs`, as a mounted tab does. */
function hold(tabId: string, inputs: ResultsInputs): () => void {
  const release = holdResults(tabId);
  setResultsInputs(tabId, inputs);
  return release;
}

describe('Results', () => {
  it('adds each page of the run loading after the rows so far, each row with its id', () => {
    const release = hold('pages', { idColumn: 'User', stored: null });
    const changes = changesOf('pages');
    runLoading('pages', { runId: 'r1', columns, rowCount: 3 }, 'User');
    pageLoaded('pages', 'r1', [row(0, 'alice'), row(1, 'bob')]);
    pageLoaded('pages', 'r1', [row(2, 'carol')]);

    expect(resultsOf('pages')).toMatchObject({
      runId: 'r1',
      columns,
      total: 3,
      done: false,
      idColumn: 'User',
      rows: [
        { row: 0, data: { User: 'alice' }, id: 'alice' },
        { row: 1, data: { User: 'bob' }, id: 'bob' },
        { row: 2, data: { User: 'carol' }, id: 'carol' },
      ],
    });
    expect(changes.filter((c) => c.type === 'added').map((c) => c.rows.map((r) => r.id))).toEqual([
      ['alice', 'bob'],
      ['carol'],
    ]);
    release();
  });

  it('reads the rows of the last succeeded run back from IndexedDB after a page reload', async () => {
    hold('reload', { idColumn: 'User', stored: null });
    await succeeded('reload', 'r1', [row(0, 'alice'), row(1, 'bob')]);
    expect(resultsOf('reload')?.done).toBe(true);

    clearResults();
    hold('reload', { idColumn: 'User', stored: stored('r1', 2) });
    await expect
      .poll(() => resultsOf('reload'))
      .toMatchObject({
        runId: 'r1',
        columns,
        total: 2,
        done: true,
        rows: [
          { row: 0, data: { User: 'alice' }, id: 'alice' },
          { row: 1, data: { User: 'bob' }, id: 'bob' },
        ],
      });
  });

  it('gives back the last succeeded run’s rows when a rerun fails or is cancelled while its rows load', async () => {
    hold('rerun', { idColumn: 'User', stored: null });
    await succeeded('rerun', 'r1', [row(0, 'alice'), row(1, 'bob')]);
    setResultsInputs('rerun', { idColumn: 'User', stored: stored('r1', 2) });

    runLoading('rerun', { runId: 'r2', columns, rowCount: 2 }, 'User');
    pageLoaded('rerun', 'r2', [row(0, 'dave')]);
    expect(resultsOf('rerun')?.rows.map((r) => r.id)).toEqual(['dave']);
    loadAbandoned('rerun', 'r2');

    await expect
      .poll(() => resultsOf('rerun'))
      .toMatchObject({
        runId: 'r1',
        done: true,
        rows: [{ id: 'alice' }, { id: 'bob' }],
      });
  });

  it('re-keys the rows when the Id column changes: their new ids, with those ids’ annotations', async () => {
    await getAnnotationStore().apply(
      [annotated('switch-alice', 1, 'malicious'), annotated('switch-h1', 1, 'benign')],
      'feed',
    );
    const long = 'x'.repeat(512);
    const rows: RunRow[] = [
      { row: 0, data: { User: 'switch-alice', Host: 'switch-h1' } },
      { row: 1, data: { User: 'switch-bob', Host: '' } },
      { row: 2, data: { User: 'switch-carol', Host: null } },
      { row: 3, data: { User: 'switch-dave' } },
      { row: 4, data: { User: 'switch-eve', Host: `${long}x` } },
      { row: 5, data: { User: 'switch-frank', Host: long } },
      { row: 6, data: { User: 'switch-alice', Host: 7 } },
    ];
    hold('switch', { idColumn: 'User', stored: null });
    runLoading('switch', { runId: 'r1', columns, rowCount: rows.length }, 'User');
    pageLoaded('switch', 'r1', rows);
    const labels = () => resultsOf('switch')?.rows.map((r) => r.annotations?.label?.key ?? null);
    await expect.poll(labels).toEqual(['malicious', null, null, null, null, null, 'malicious']);

    setResultsInputs('switch', { idColumn: 'Host', stored: null });
    expect(resultsOf('switch')?.idColumn).toBe('Host');
    expect(resultsOf('switch')?.rows.map((r) => r.id)).toEqual([
      'switch-h1',
      null,
      null,
      null,
      null,
      long,
      '7',
    ]);
    await expect.poll(labels).toEqual(['benign', null, null, null, null, null, null]);

    setResultsInputs('switch', { idColumn: 'User', stored: null });
    await expect.poll(labels).toEqual(['malicious', null, null, null, null, null, 'malicious']);
    expect(resultsOf('switch')?.rowsById.get('switch-alice')).toEqual(['0', '6']);
  });

  it('gives a change from the feed to every row with its id', async () => {
    hold('feed', { idColumn: 'User', stored: null });
    const changes = changesOf('feed');
    runLoading('feed', { runId: 'r1', columns, rowCount: 3 }, 'User');
    pageLoaded('feed', 'r1', [row(0, 'feed-alice'), row(1, 'feed-bob'), row(2, 'feed-alice')]);

    await getAnnotationStore().apply([annotated('feed-alice', 3, 'benign')], 'feed');
    await expect
      .poll(() => resultsOf('feed')?.rows.map((r) => r.annotations?.label?.key ?? null))
      .toEqual(['benign', null, 'benign']);
    const fromFeed = changes.filter((c) => c.type === 'annotated' && c.source === 'feed');
    expect(fromFeed.map((c) => c.type === 'annotated' && c.rows.map((r) => r.row))).toEqual([
      [0, 2],
    ]);
  });

  it('lets the rows go when the tab leaves the mounted tabs, and reads them back on the next visit', async () => {
    const release = hold('visit', { idColumn: 'User', stored: null });
    await succeeded('visit', 'r1', [row(0, 'alice')]);
    const inMemory = resultsOf('visit');
    release();
    expect(resultsOf('visit')).toBeNull();

    hold('visit', { idColumn: 'User', stored: stored('r1', 1) });
    await expect
      .poll(() => resultsOf('visit')?.rows)
      .toEqual([{ row: 0, data: { User: 'alice' }, id: 'alice' }]);
    expect(resultsOf('visit')?.rows[0]).not.toBe(inMemory?.rows[0]);
  });

  it('keeps the rows of a run loading in a tab that isn’t mounted until they have all arrived', async () => {
    runLoading('unmounted', { runId: 'r1', columns, rowCount: 2 }, 'User');
    pageLoaded('unmounted', 'r1', [row(0, 'alice')]);
    expect(resultsOf('unmounted')?.rows).toHaveLength(1);
    await rowResultsDao.put('unmounted', [row(0, 'alice'), row(1, 'bob')]);
    pageLoaded('unmounted', 'r1', [row(1, 'bob')]);
    runLoaded('unmounted', 'r1');
    expect(resultsOf('unmounted')).toBeNull();
  });

  it('lets go of a closed tab’s rows', async () => {
    const tabId = useTabsStore
      .getState()
      .createTab({ parentId: null, content: content('Sign-ins') });
    hold(tabId, { idColumn: 'User', stored: null });
    runLoading(tabId, { runId: 'r1', columns, rowCount: 1 }, 'User');
    await useTabsStore.getState().removeTab(tabId);
    expect(resultsOf(tabId)).toBeNull();
  });
});
