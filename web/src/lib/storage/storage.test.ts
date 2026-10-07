import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  columnViewsDao,
  displayComponentsDao,
  openTimDb,
  queryOptionsDao,
  resetTimDb,
  rowResultsDao,
  type ColumnView,
  type DisplayComponent,
} from './index';

function makeComponent(id: string, parentUuid: string | null = null): DisplayComponent {
  return {
    componentUuid: id,
    componentName: 'KustoQueryResult',
    title: `t-${id}`,
    parentUuid,
    rowDataTrigger: null,
    displayComponentIndex: 0,
    params: { query: 'T | take 1', cluster: '', database: '' },
    state: { isVisited: false, error: null, rowCount: null, isExecuting: false },
  };
}

beforeEach(async () => {
  await resetTimDb();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(async () => {
  await resetTimDb();
  vi.restoreAllMocks();
});

describe('openTimDb', () => {
  it('creates database "tim" v1 with the four stores', async () => {
    const db = await openTimDb();
    expect(db.name).toBe('tim');
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames].sort()).toEqual([
      'column_views',
      'display_components',
      'query_options',
      'row_results',
    ]);
  });

  it('is a singleton until reset', async () => {
    const a = await openTimDb();
    expect(await openTimDb()).toBe(a);
    await resetTimDb();
    const b = await openTimDb();
    expect(b).not.toBe(a);
  });

  it('only ever opens the "tim" database', async () => {
    const spy = vi.spyOn(indexedDB, 'open');
    await displayComponentsDao.getAll();
    await rowResultsDao.get('x');
    await columnViewsDao.list();
    await queryOptionsDao.getAll();
    await resetTimDb();
    await openTimDb();
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) expect(call[0]).toBe('tim');
  });
});

describe('displayComponentsDao', () => {
  it('puts, gets, lists and deletes many', async () => {
    expect(await displayComponentsDao.getAll()).toEqual([]);
    await displayComponentsDao.put(makeComponent('a'));
    await displayComponentsDao.put(makeComponent('b', 'a'));
    await displayComponentsDao.put(makeComponent('c'));
    expect(await displayComponentsDao.get('b')).toEqual(makeComponent('b', 'a'));
    expect(await displayComponentsDao.get('nope')).toBeUndefined();
    expect(await displayComponentsDao.getAll()).toHaveLength(3);

    await displayComponentsDao.put({ ...makeComponent('a'), title: 'renamed' });
    expect((await displayComponentsDao.get('a'))?.title).toBe('renamed');

    await displayComponentsDao.deleteMany(['a', 'b']);
    expect((await displayComponentsDao.getAll()).map((c) => c.componentUuid)).toEqual(['c']);
  });

  it('does not persist in-memory children', async () => {
    await displayComponentsDao.put({
      ...makeComponent('a'),
      children: [makeComponent('b')],
    } as unknown as DisplayComponent);
    expect(await displayComponentsDao.get('a')).not.toHaveProperty('children');
  });
});

describe('rowResultsDao', () => {
  it('returns [] when missing', async () => {
    expect(await rowResultsDao.get('missing')).toEqual([]);
  });

  it('puts, gets and deletes', async () => {
    await rowResultsDao.put('a', [{ EventId: '1' }, { EventId: '2' }]);
    await rowResultsDao.put('b', []);
    expect(await rowResultsDao.get('a')).toEqual([{ EventId: '1' }, { EventId: '2' }]);
    expect(await rowResultsDao.get('b')).toEqual([]);
    await rowResultsDao.delete('a');
    expect(await rowResultsDao.get('a')).toEqual([]);
  });

  it('deletes many', async () => {
    await rowResultsDao.put('a', [{ x: 1 }]);
    await rowResultsDao.put('b', [{ x: 2 }]);
    await rowResultsDao.put('c', [{ x: 3 }]);
    await rowResultsDao.deleteMany(['a', 'b']);
    expect(await rowResultsDao.get('a')).toEqual([]);
    expect(await rowResultsDao.get('c')).toEqual([{ x: 3 }]);
  });
});

describe('columnViewsDao', () => {
  const view = (uuid: string, name: string): ColumnView => ({
    uuid,
    name,
    columnState: [{ colId: 'TagEvent.Tags', hide: false }],
  });

  it('lists sorted by name, puts, renames and deletes', async () => {
    expect(await columnViewsDao.list()).toEqual([]);
    await columnViewsDao.put(view('1', 'Zed'));
    await columnViewsDao.put(view('2', 'Alpha'));
    expect((await columnViewsDao.list()).map((v) => v.name)).toEqual(['Alpha', 'Zed']);

    const renamed = await columnViewsDao.rename('1', 'Beta');
    expect(renamed).toEqual(view('1', 'Beta'));
    expect((await columnViewsDao.list()).map((v) => v.name)).toEqual(['Alpha', 'Beta']);
    expect(await columnViewsDao.rename('nope', 'x')).toBeUndefined();

    await columnViewsDao.delete('2');
    expect((await columnViewsDao.list()).map((v) => v.uuid)).toEqual(['1']);
  });
});

describe('queryOptionsDao', () => {
  it('puts and gets all keyed by template uuid', async () => {
    expect(await queryOptionsDao.getAll()).toEqual({});
    await queryOptionsDao.put('t1', { hide: true });
    await queryOptionsDao.put('t2', { hide: false });
    await queryOptionsDao.put('t1', { hide: false });
    expect(await queryOptionsDao.getAll()).toEqual({ t1: { hide: false }, t2: { hide: false } });
  });
});
