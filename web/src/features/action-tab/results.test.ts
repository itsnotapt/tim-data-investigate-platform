import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAnnotationStore } from '../../lib/annotations';
import type { RunColumn, RunRow } from '../../lib/api';
import { annotated } from '../../test/annotationFakes';
import { content } from '../../test/tabsTestUtils';
import { useInstanceStore } from '../instance';
import { useTabsStore } from '../tabs/tabStore';
import { rowResultsDao, type TabResults } from '../../lib/storage';
import {
  clearResults,
  holdResults,
  loadAbandoned,
  pageLoaded,
  resultRows,
  resultsOf,
  rowNumberOf,
  runLoaded,
  runLoading,
  setResultsInputs,
  subscribeResults,
  type ResultsChange,
  type ResultsInputs,
} from './results';

const columns: RunColumn[] = [{ name: 'User', type: 'string', declared: true, duplicates: 0 }];
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

/** Pages of two rows, so a few rows make several. */
const ROWS_PAGE_SIZE = 2;

beforeEach(() => {
  useTabsStore.reset();
  useInstanceStore.setState({
    instance: {
      version: 'v1',
      actions: [],
      connections: [],
      labels: [],
      limits: {
        maxResultRows: 100,
        maxResultBytes: 1_000_000,
        maxPivotRows: 100,
        rowsPageSize: ROWS_PAGE_SIZE,
        runTimeoutSeconds: 600,
        maxAnnotationIds: 10_000,
        annotationPollSeconds: 30,
      },
    },
  });
});
afterEach(() => clearResults());

/** Holds the tab's Results, given `inputs`, as a mounted tab does. */
function hold(tabId: string, inputs: ResultsInputs): () => void {
  const release = holdResults(tabId);
  setResultsInputs(tabId, inputs);
  return release;
}

describe('Results', () => {
  it('gives the rows of row numbers, and the row numbers of an id, under the Id column as it is now', () => {
    hold('lookup', { idColumn: 'User', stored: null });
    runLoading('lookup', { runId: 'r1', columns, rowCount: 3 }, 'User');
    pageLoaded('lookup', 'r1', [row(0, 'alice'), row(1, 'bob')]);
    pageLoaded('lookup', 'r1', [{ row: 2, data: { User: 'carol', Host: 'h1' } }]);
    expect(resultRows('lookup', [2, 3, 0]).map((r) => [r.row, r.id])).toEqual([
      [2, 'carol'],
      [0, 'alice'],
    ]);
    expect(rowNumberOf('lookup', 'alice')).toBe(0);

    setResultsInputs('lookup', { idColumn: 'Host', stored: null });
    expect(resultRows('lookup', [0, 2]).map((r) => [r.row, r.id, r.data])).toEqual([
      [0, null, { User: 'alice' }],
      [2, 'h1', { User: 'carol', Host: 'h1' }],
    ]);
    expect(rowNumberOf('lookup', 'alice')).toBeUndefined();
    expect(rowNumberOf('lookup', 'h1')).toBe(2);
    expect(resultRows('other', [0])).toEqual([]);
  });

  it('gives no row an id while the Id column has duplicates, and each id one row otherwise', () => {
    const counted: RunColumn[] = [
      { name: 'User', type: 'string', declared: true, duplicates: 1 },
      { name: 'Sid', type: 'string', declared: false, duplicates: 0 },
    ];
    const rows: RunRow[] = [
      { row: 0, data: { User: 'dup-alice', Sid: 's-1' } },
      { row: 1, data: { User: 'dup-bob', Sid: 's-2' } },
      { row: 2, data: { User: 'dup-alice', Sid: 's-3' } },
    ];
    hold('duplicates', { idColumn: 'User', stored: null });
    runLoading('duplicates', { runId: 'r1', columns: counted, rowCount: 3 }, 'User');
    pageLoaded('duplicates', 'r1', rows);
    expect(resultRows('duplicates', [0, 1, 2]).map((r) => r.id)).toEqual([null, null, null]);
    expect(rowNumberOf('duplicates', 'dup-bob')).toBeUndefined();

    setResultsInputs('duplicates', { idColumn: 'Sid', stored: null });
    expect(resultRows('duplicates', [0, 1, 2]).map((r) => r.id)).toEqual(['s-1', 's-2', 's-3']);
    expect(rowNumberOf('duplicates', 's-3')).toBe(2);
    expect(resultsOf('duplicates')?.rowNumberById.get('s-2')).toBe(1);
  });

  it('keeps the rows in pages of the rows page size, topping up a short last page', () => {
    hold('paged', { idColumn: 'User', stored: null });
    runLoading('paged', { runId: 'r1', columns, rowCount: 5 }, 'User');
    pageLoaded('paged', 'r1', [row(0, 'alice')]);
    pageLoaded('paged', 'r1', [row(1, 'bob'), row(2, 'carol')]);
    pageLoaded('paged', 'r1', [row(3, 'dave'), row(4, 'eve')]);

    const rows = resultsOf('paged')!.rows;
    expect(rows.pages.map((p) => p.map((r) => r.id))).toEqual([
      ['alice', 'bob'],
      ['carol', 'dave'],
      ['eve'],
    ]);
    expect(rows.length).toBe(5);
    expect([0, 1, 2, 3, 4, 5].map((n) => rows.at(n)?.id)).toEqual([
      'alice',
      'bob',
      'carol',
      'dave',
      'eve',
      undefined,
    ]);
    expect(rows.flat().map((r) => r.row)).toEqual([0, 1, 2, 3, 4]);
    expect(resultRows('paged', [5, 3, 1]).map((r) => r.id)).toEqual(['dave', 'bob']);
  });

  it('adds a page without copying the full pages before it', () => {
    hold('shared', { idColumn: 'User', stored: null });
    runLoading('shared', { runId: 'r1', columns, rowCount: 5 }, 'User');
    pageLoaded('shared', 'r1', [row(0, 'alice'), row(1, 'bob'), row(2, 'carol')]);
    const before = resultsOf('shared')!.rows;

    pageLoaded('shared', 'r1', [row(3, 'dave'), row(4, 'eve')]);
    const after = resultsOf('shared')!.rows;
    expect(after.pages[0]).toBe(before.pages[0]);
    expect(before.pages.map((p) => p.length)).toEqual([2, 1]);
    expect(after.pages.map((p) => p.length)).toEqual([2, 2, 1]);
  });

  it('gives a page that arrives after the Id column changes its rows’ ids under the new column', () => {
    hold('switching', { idColumn: 'User', stored: null });
    runLoading('switching', { runId: 'r1', columns, rowCount: 3 }, 'User');
    pageLoaded('switching', 'r1', [{ row: 0, data: { User: 'alice', Host: 'h1' } }]);
    setResultsInputs('switching', { idColumn: 'Host', stored: null });
    pageLoaded('switching', 'r1', [
      { row: 1, data: { User: 'bob', Host: 'h2' } },
      { row: 2, data: { User: 'carol', Host: 'h3' } },
    ]);

    const rows = resultsOf('switching')!.rows;
    expect(rows.pages.map((p) => p.map((r) => r.id))).toEqual([['h1', 'h2'], ['h3']]);
    expect(rowNumberOf('switching', 'h3')).toBe(2);
    expect(rowNumberOf('switching', 'alice')).toBeUndefined();
  });

  it('keeps a snapshot as it was after a later page arrives and a row of its page is annotated', async () => {
    hold('snapshot', { idColumn: 'User', stored: null });
    runLoading('snapshot', { runId: 'r1', columns, rowCount: 3 }, 'User');
    pageLoaded('snapshot', 'r1', [row(0, 'snapshot-alice')]);
    const before = resultsOf('snapshot')!;
    const alice = before.rows.at(0);

    pageLoaded('snapshot', 'r1', [row(1, 'snapshot-bob'), row(2, 'snapshot-carol')]);
    await getAnnotationStore().apply([annotated('snapshot-alice', 1, 'benign')], 'own');
    await expect
      .poll(() => resultsOf('snapshot')?.rows.at(0)?.annotations?.label?.key)
      .toBe('benign');

    expect(before.rows.length).toBe(1);
    expect(before.rows.flat()).toEqual([
      { row: 0, data: { User: 'snapshot-alice' }, id: 'snapshot-alice' },
    ]);
    expect(before.rows.at(0)).toBe(alice);
    expect(before.rows.at(1)).toBeUndefined();
  });

  it('copies only the pages holding the rows an annotation change gives annotations', async () => {
    hold('copies', { idColumn: 'User', stored: null });
    runLoading('copies', { runId: 'r1', columns, rowCount: 5 }, 'User');
    pageLoaded('copies', 'r1', [
      row(0, 'copies-alice'),
      row(1, 'copies-bob'),
      row(2, 'copies-carol'),
      row(3, 'copies-dave'),
      row(4, 'copies-eve'),
    ]);
    const before = resultsOf('copies')!.rows;

    await getAnnotationStore().apply(
      [annotated('copies-alice', 1, 'benign'), annotated('copies-eve', 1, 'benign')],
      'own',
    );
    await expect.poll(() => resultsOf('copies')?.rows).not.toBe(before);

    const after = resultsOf('copies')!.rows;
    expect(after.flat().map((r) => r.annotations?.label?.key ?? null)).toEqual([
      'benign',
      null,
      null,
      null,
      'benign',
    ]);
    expect(after.pages[2]).not.toBe(before.pages[2]);
    expect(after.pages[1]).toBe(before.pages[1]);
    expect(after.pages[0]).not.toBe(before.pages[0]);
    expect(after.at(1)).toBe(before.at(1));
  });

  it('refuses a page whose row numbers don’t continue the rows so far', () => {
    hold('numbers', { idColumn: 'User', stored: null });
    runLoading('numbers', { runId: 'r1', columns, rowCount: 5 }, 'User');
    pageLoaded('numbers', 'r1', [row(0, 'alice'), row(1, 'bob')]);

    expect(() => pageLoaded('numbers', 'r1', [row(3, 'dave')])).toThrow(
      'Expected row 2 next, got row 3',
    );
    expect(() => pageLoaded('numbers', 'r1', [row(2, 'carol'), row(4, 'eve')])).toThrow(
      'Expected row 3 next, got row 4',
    );
    expect(
      resultsOf('numbers')
        ?.rows.flat()
        .map((r) => r.row),
    ).toEqual([0, 1]);
  });

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
    });
    expect(resultsOf('pages')?.rows.flat()).toEqual([
      { row: 0, data: { User: 'alice' }, id: 'alice' },
      { row: 1, data: { User: 'bob' }, id: 'bob' },
      { row: 2, data: { User: 'carol' }, id: 'carol' },
    ]);
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
      .toMatchObject({ runId: 'r1', columns, total: 2, done: true });
    expect(resultsOf('reload')?.rows.flat()).toEqual([
      { row: 0, data: { User: 'alice' }, id: 'alice' },
      { row: 1, data: { User: 'bob' }, id: 'bob' },
    ]);
  });

  it('reads none of the stored rows when their row numbers don’t go up by one from 0', async () => {
    await rowResultsDao.put('gaps', [row(0, 'alice'), row(2, 'carol')]);
    hold('gaps', { idColumn: 'User', stored: stored('r1', 2) });
    await expect.poll(() => resultsOf('gaps')).toMatchObject({ runId: 'r1', total: 2, done: true });
    expect(resultsOf('gaps')?.rows.length).toBe(0);
  });

  it('gives back the last succeeded run’s rows when a rerun fails or is cancelled while its rows load', async () => {
    hold('rerun', { idColumn: 'User', stored: null });
    await succeeded('rerun', 'r1', [row(0, 'alice'), row(1, 'bob')]);
    setResultsInputs('rerun', { idColumn: 'User', stored: stored('r1', 2) });

    runLoading('rerun', { runId: 'r2', columns, rowCount: 2 }, 'User');
    pageLoaded('rerun', 'r2', [row(0, 'dave')]);
    expect(
      resultsOf('rerun')
        ?.rows.flat()
        .map((r) => r.id),
    ).toEqual(['dave']);
    loadAbandoned('rerun', 'r2');

    await expect.poll(() => resultsOf('rerun')).toMatchObject({ runId: 'r1', done: true });
    expect(
      resultsOf('rerun')
        ?.rows.flat()
        .map((r) => r.id),
    ).toEqual(['alice', 'bob']);
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
      { row: 6, data: { User: 'switch-grace', Host: 7 } },
    ];
    hold('switch', { idColumn: 'User', stored: null });
    runLoading('switch', { runId: 'r1', columns, rowCount: rows.length }, 'User');
    pageLoaded('switch', 'r1', rows);
    const labels = () =>
      resultsOf('switch')
        ?.rows.flat()
        .map((r) => r.annotations?.label?.key ?? null);
    await expect.poll(labels).toEqual(['malicious', null, null, null, null, null, null]);

    setResultsInputs('switch', { idColumn: 'Host', stored: null });
    expect(resultsOf('switch')?.idColumn).toBe('Host');
    expect(
      resultsOf('switch')
        ?.rows.flat()
        .map((r) => r.id),
    ).toEqual(['switch-h1', null, null, null, null, long, '7']);
    await expect.poll(labels).toEqual(['benign', null, null, null, null, null, null]);

    setResultsInputs('switch', { idColumn: 'User', stored: null });
    await expect.poll(labels).toEqual(['malicious', null, null, null, null, null, null]);
    expect(resultsOf('switch')?.rows.pages.map((p) => p.length)).toEqual([2, 2, 2, 1]);
    expect(resultsOf('switch')?.rowNumberById.get('switch-alice')).toBe(0);
  });

  it('gives a change from the feed to every row with its id', async () => {
    hold('feed', { idColumn: 'User', stored: null });
    const changes = changesOf('feed');
    runLoading('feed', { runId: 'r1', columns, rowCount: 3 }, 'User');
    pageLoaded('feed', 'r1', [row(0, 'feed-alice'), row(1, 'feed-bob'), row(2, 'feed-carol')]);

    await getAnnotationStore().apply(
      [annotated('feed-alice', 3, 'benign'), annotated('feed-carol', 3, 'benign')],
      'feed',
    );
    await expect
      .poll(() =>
        resultsOf('feed')
          ?.rows.flat()
          .map((r) => r.annotations?.label?.key ?? null),
      )
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
      .poll(() => resultsOf('visit')?.rows.flat())
      .toEqual([{ row: 0, data: { User: 'alice' }, id: 'alice' }]);
    expect(resultsOf('visit')?.rows.at(0)).not.toBe(inMemory?.rows.at(0));
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
