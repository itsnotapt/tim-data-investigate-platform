import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultViewsDao, openTimDb, resetTimDb, rowResultsDao, tabsDao, type Tab } from './index';

function makeTab(id: string, parentId: string | null = null): Tab {
  return {
    id,
    parentId,
    index: 0,
    visited: false,
    title: `t-${id}`,
    toRun: { action: 'acme.sign_ins', params: {} },
    latest: { run: null, params: null, title: null },
    results: null,
    grid: { gridState: null, columnView: null },
    status: {
      executing: false,
      cancelling: false,
      error: null,
      paramErrors: null,
      linkedRow: null,
      pivotMissing: null,
    },
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
  it('creates database "tim" v6 with the five stores', async () => {
    const db = await openTimDb();
    expect(db.name).toBe('tim');
    expect(db.version).toBe(6);
    expect([...db.objectStoreNames].sort()).toEqual([
      'annotation_sync',
      'annotations',
      'applied_views',
      'row_results',
      'tabs',
    ]);
  });

  it('upgrades a v1 database', async () => {
    const v1 = await openDB('tim', 1, {
      upgrade(db) {
        db.createObjectStore('display_components', { keyPath: 'componentUuid' });
        db.createObjectStore('row_results');
        db.createObjectStore('column_views', { keyPath: 'uuid' });
        db.createObjectStore('query_options');
      },
    });
    v1.close();

    const db = await openTimDb();
    expect(db.version).toBe(6);
    expect(db.objectStoreNames).toContain('annotations');
    expect(db.objectStoreNames).toContain('applied_views');
    expect(db.objectStoreNames).not.toContain('query_options');
    expect(db.objectStoreNames).not.toContain('column_views');
  });

  it('upgrades a v2 database', async () => {
    const v2 = await openDB('tim', 2, {
      upgrade(db) {
        db.createObjectStore('display_components', { keyPath: 'componentUuid' });
        db.createObjectStore('row_results');
        db.createObjectStore('column_views', { keyPath: 'uuid' });
        db.createObjectStore('query_options');
        db.createObjectStore('annotations', { keyPath: 'id' });
        db.createObjectStore('annotation_sync');
      },
    });
    v2.close();

    const db = await openTimDb();
    expect(db.version).toBe(6);
    expect(db.objectStoreNames).toContain('applied_views');
    expect(db.objectStoreNames).not.toContain('query_options');
    expect(db.objectStoreNames).not.toContain('column_views');
  });

  it('upgrades a v3 database, dropping query_options', async () => {
    const v3 = await openDB('tim', 3, {
      upgrade(db) {
        db.createObjectStore('display_components', { keyPath: 'componentUuid' });
        db.createObjectStore('row_results');
        db.createObjectStore('column_views', { keyPath: 'uuid' });
        db.createObjectStore('query_options');
        db.createObjectStore('annotations', { keyPath: 'id' });
        db.createObjectStore('annotation_sync');
        db.createObjectStore('applied_views', { keyPath: ['analyst', 'scope'] }).createIndex(
          'analyst',
          'analyst',
        );
      },
    });
    await v3.put('query_options', { hide: true }, 'tpl-1');
    v3.close();

    const db = await openTimDb();
    expect(db.version).toBe(6);
    expect(db.objectStoreNames).not.toContain('query_options');
    expect(db.objectStoreNames).not.toContain('column_views');
  });

  it('upgrades a v4 database, dropping column_views', async () => {
    const v4 = await openDB('tim', 4, {
      upgrade(db) {
        db.createObjectStore('display_components', { keyPath: 'componentUuid' });
        db.createObjectStore('row_results');
        db.createObjectStore('column_views', { keyPath: 'uuid' });
        db.createObjectStore('annotations', { keyPath: 'id' });
        db.createObjectStore('annotation_sync');
        db.createObjectStore('applied_views', { keyPath: ['analyst', 'scope'] }).createIndex(
          'analyst',
          'analyst',
        );
      },
    });
    await v4.put('column_views', { uuid: 'v1', name: 'Triage', columnState: [] });
    v4.close();

    const db = await openTimDb();
    expect(db.version).toBe(6);
    expect(db.objectStoreNames).not.toContain('column_views');
  });

  it('upgrades a v5 database, dropping its tabs and their rows and keeping the rest', async () => {
    const v5 = await openDB('tim', 5, {
      upgrade(db) {
        db.createObjectStore('display_components', { keyPath: 'componentUuid' });
        db.createObjectStore('row_results');
        db.createObjectStore('annotations', { keyPath: 'id' });
        db.createObjectStore('annotation_sync');
        db.createObjectStore('applied_views', { keyPath: ['analyst', 'scope'] }).createIndex(
          'analyst',
          'analyst',
        );
      },
    });
    await v5.put('display_components', { componentUuid: 'tab-1', title: 'old' });
    await v5.put('row_results', [{ row: 0 }], 'tab-1');
    await v5.put('annotation_sync', 7, 'cursor');
    v5.close();

    const db = await openTimDb();
    expect(db.version).toBe(6);
    expect(db.objectStoreNames).not.toContain('display_components');
    expect(await tabsDao.getAll()).toEqual([]);
    expect(await rowResultsDao.get('tab-1')).toEqual([]);
    expect(await db.get('annotation_sync', 'cursor')).toBe(7);
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
    await tabsDao.getAll();
    await rowResultsDao.get('x');
    await resetTimDb();
    await openTimDb();
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) expect(call[0]).toBe('tim');
  });
});

describe('tabsDao', () => {
  it('puts, gets, lists and deletes many', async () => {
    expect(await tabsDao.getAll()).toEqual([]);
    await tabsDao.put(makeTab('a'));
    await tabsDao.put(makeTab('b', 'a'));
    await tabsDao.put(makeTab('c'));
    expect(await tabsDao.get('b')).toEqual(makeTab('b', 'a'));
    expect(await tabsDao.get('nope')).toBeUndefined();
    expect(await tabsDao.getAll()).toHaveLength(3);

    await tabsDao.put({ ...makeTab('a'), title: 'renamed' });
    expect((await tabsDao.get('a'))?.title).toBe('renamed');

    await tabsDao.deleteMany(['a', 'b']);
    expect((await tabsDao.getAll()).map((t) => t.id)).toEqual(['c']);
  });

  it('does not persist in-memory children', async () => {
    await tabsDao.put({ ...makeTab('a'), children: [makeTab('b')] } as unknown as Tab);
    expect(await tabsDao.get('a')).not.toHaveProperty('children');
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

describe('defaultViewsDao', () => {
  const entry = (analyst: string, scope: string, name = 'Triage') => ({
    analyst,
    scope,
    viewId: `${analyst}-${scope}`,
    name,
  });

  it("lists one analyst's entries, replaces by scope and deletes", async () => {
    await defaultViewsDao.put(entry('alice', 'action:sign-ins'));
    await defaultViewsDao.put(entry('alice', 'preset:p1'));
    await defaultViewsDao.put(entry('bob', 'action:sign-ins'));
    await defaultViewsDao.put(entry('alice', 'action:sign-ins', 'Renamed'));

    const alices = await defaultViewsDao.list('alice');
    expect(alices.map((a) => [a.scope, a.name]).sort()).toEqual([
      ['action:sign-ins', 'Renamed'],
      ['preset:p1', 'Triage'],
    ]);

    await defaultViewsDao.delete('alice', 'preset:p1');
    expect((await defaultViewsDao.list('alice')).map((a) => a.scope)).toEqual(['action:sign-ins']);
    expect(await defaultViewsDao.list('bob')).toEqual([entry('bob', 'action:sign-ins')]);
  });
});
