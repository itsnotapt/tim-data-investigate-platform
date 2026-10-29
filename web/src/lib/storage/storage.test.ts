import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultViewsDao,
  displayComponentsDao,
  openTimDb,
  resetTimDb,
  rowResultsDao,
  type DisplayComponent,
} from './index';

function makeComponent(id: string, parentUuid: string | null = null): DisplayComponent {
  return {
    componentUuid: id,
    componentName: 'ActionResult',
    title: `t-${id}`,
    parentUuid,
    rowDataTrigger: null,
    displayComponentIndex: 0,
    params: { action: 'acme.sign_ins', params: {} },
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
  it('creates database "tim" v5 with the five stores', async () => {
    const db = await openTimDb();
    expect(db.name).toBe('tim');
    expect(db.version).toBe(5);
    expect([...db.objectStoreNames].sort()).toEqual([
      'annotation_sync',
      'annotations',
      'applied_views',
      'display_components',
      'row_results',
    ]);
  });

  it('upgrades a v1 database, keeping its data', async () => {
    const v1 = await openDB('tim', 1, {
      upgrade(db) {
        db.createObjectStore('display_components', { keyPath: 'componentUuid' });
        db.createObjectStore('row_results');
        db.createObjectStore('column_views', { keyPath: 'uuid' });
        db.createObjectStore('query_options');
      },
    });
    await v1.put('row_results', [{ row: 0 }], 'tab-1');
    v1.close();

    const db = await openTimDb();
    expect(db.version).toBe(5);
    expect(db.objectStoreNames).toContain('annotations');
    expect(db.objectStoreNames).toContain('applied_views');
    expect(db.objectStoreNames).not.toContain('query_options');
    expect(db.objectStoreNames).not.toContain('column_views');
    expect(await rowResultsDao.get('tab-1')).toEqual([{ row: 0 }]);
  });

  it('upgrades a v2 database, keeping its data', async () => {
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
    await v2.put('row_results', [{ row: 0 }], 'tab-1');
    v2.close();

    const db = await openTimDb();
    expect(db.version).toBe(5);
    expect(db.objectStoreNames).toContain('applied_views');
    expect(db.objectStoreNames).not.toContain('query_options');
    expect(db.objectStoreNames).not.toContain('column_views');
    expect(await rowResultsDao.get('tab-1')).toEqual([{ row: 0 }]);
  });

  it('upgrades a v3 database, dropping query_options and keeping the rest', async () => {
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
    await v3.put('row_results', [{ row: 0 }], 'tab-1');
    await v3.put('query_options', { hide: true }, 'tpl-1');
    v3.close();

    const db = await openTimDb();
    expect(db.version).toBe(5);
    expect(db.objectStoreNames).not.toContain('query_options');
    expect(db.objectStoreNames).not.toContain('column_views');
    expect(await rowResultsDao.get('tab-1')).toEqual([{ row: 0 }]);
  });

  it('upgrades a v4 database, dropping column_views and keeping the rest', async () => {
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
    await v4.put('display_components', makeComponent('tab-1'));
    await v4.put('row_results', [{ row: 0 }], 'tab-1');
    await v4.put('column_views', { uuid: 'v1', name: 'Triage', columnState: [] });
    v4.close();

    const db = await openTimDb();
    expect(db.version).toBe(5);
    expect(db.objectStoreNames).not.toContain('column_views');
    expect(await displayComponentsDao.getAll()).toEqual([makeComponent('tab-1')]);
    expect(await rowResultsDao.get('tab-1')).toEqual([{ row: 0 }]);
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
