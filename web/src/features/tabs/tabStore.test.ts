import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTimDb, rowResultsDao, tabsDao, type TabContent } from '../../lib/storage';
import { tab } from '../../test/tabsTestUtils';
import {
  createTabsStore,
  selectAncestors,
  selectChildrenOf,
  selectRoots,
  selectSubtreeIds,
  selectTab,
  toStoredError,
  type TabsStore,
} from './index';

let store: TabsStore;

beforeEach(async () => {
  await resetTimDb();
  globalThis.indexedDB = new IDBFactory();
  store = createTabsStore({ debounceMs: 10 });
});
afterEach(async () => {
  vi.useRealTimers();
  await store.getState().flush();
  await resetTimDb();
});

/** Creates a tab with a generated id under `parentId`, titled `title`. */
function create(parentId: string | null, title = 't'): string {
  const { content } = tab('unused', parentId, { title });
  return store.getState().createTab({ parentId, content });
}

const retitled =
  (title: string) =>
  (t: TabContent): TabContent => ({ ...t, title });

/** A fresh store over the same IndexedDB, as after a page reload. */
async function reload() {
  await store.getState().flush();
  const fresh = createTabsStore({ debounceMs: 10 });
  await fresh.getState().load();
  await fresh.getState().flush(); // load re-saves renumbered indexes
  return fresh;
}

describe('create', () => {
  it('creates root and child tabs and exposes them through selectors', () => {
    const a = create(null, 'a');
    const b = create(a, 'b');
    const c = create(null, 'c');
    const st = store.getState();
    expect(selectRoots(st).map((t) => t.id)).toEqual([a, c]);
    expect(selectChildrenOf(st, a).map((t) => t.id)).toEqual([b]);
    expect(selectAncestors(st, b).map((t) => t.id)).toEqual([a]);
    expect(selectTab(st, b)?.parentId).toBe(a);
    expect(selectSubtreeIds(st, a)).toEqual([a, b]);
    expect(st.lastCreated?.id).toBe(c);
    expect(st.tabs[a]).toMatchObject({ title: 'a', visited: false });
  });

  it('keeps the id it is given', () => {
    expect(store.getState().createTab(tab('given'))).toBe('given');
    expect(store.getState().tabs['given']?.title).toBe('T-given');
  });

  it('ancestors path is root first', () => {
    const a = create(null);
    const b = create(a);
    const c = create(b);
    expect(selectAncestors(store.getState(), c).map((t) => t.id)).toEqual([a, b]);
    expect(selectAncestors(store.getState(), a)).toEqual([]);
  });
});

describe('apply', () => {
  it("changes a tab's content and keeps its place in the tree and visited mark", () => {
    const a = create(null);
    const b = create(a, 'b');
    store.getState().markVisited(b);
    const before = store.getState().tabs[b]!;

    store.getState().apply(b, (t) => ({
      ...retitled('changed')(t),
      // A transition cannot move or re-id the tab.
      ...({ id: 'x', parentId: null, index: 99, visited: false } as object),
    }));

    expect(store.getState().tabs[b]).toEqual({ ...before, title: 'changed' });
  });

  it('ignores an unknown tab', () => {
    const before = store.getState().tabs;
    store.getState().apply('nope', retitled('x'));
    expect(store.getState().tabs).toBe(before);
  });
});

describe('persistence', () => {
  it('debounces writes and coalesces changes', async () => {
    // Only the debounce timer is faked; fake-indexeddb needs the real setImmediate.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const idbPut = vi.spyOn(IDBObjectStore.prototype, 'put');
    const tabWrites = () =>
      idbPut.mock.contexts.filter((s) => (s as IDBObjectStore).name === 'tabs').length;
    const a = create(null);
    store.getState().apply(a, retitled('x'));
    store.getState().apply(a, retitled('y'));
    await vi.advanceTimersByTimeAsync(5);
    expect(tabWrites()).toBe(0);
    expect(await tabsDao.get(a)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(20);
    await store.getState().flush();
    expect(tabWrites()).toBe(1);
    expect((await tabsDao.get(a))?.title).toBe('y');
    idbPut.mockRestore();
  });

  it('reload preserves order, parents and content', async () => {
    const a = create(null, 'a');
    const b = create(a, 'b');
    const c = create(null, 'c');
    const d = create(b, 'd');
    store.getState().markVisited(c);
    store.getState().apply(c, (t) => ({ ...t, toRun: { ...t.toRun, params: { limit: 5 } } }));
    const fresh = await reload();
    const st = fresh.getState();
    expect(st.loaded).toBe(true);
    expect(st.order).toEqual([a, b, c, d]);
    expect(selectRoots(st).map((t) => t.title)).toEqual(['a', 'c']);
    expect(selectChildrenOf(st, b).map((t) => t.id)).toEqual([d]);
    expect(st.tabs[c]).toMatchObject({ visited: true, toRun: { params: { limit: 5 } } });
    expect(st.tabs[d]?.index).toBe(3);
    // New tabs continue after the loaded ones, and a second reload keeps the order.
    const e = st.createTab({ parentId: null, content: tab('e').content });
    await fresh.getState().flush();
    const again = createTabsStore({ debounceMs: 10 });
    await again.getState().load();
    await again.getState().flush();
    expect(again.getState().order).toEqual([a, b, c, d, e]);
  });

  it('load sorts by index and turns a missing parent into a root', async () => {
    const stored = (id: string, parentId: string | null, index: number) => ({
      ...tab(id, parentId).content,
      id,
      parentId,
      index,
      visited: false,
    });
    await tabsDao.put(stored('late', 'early', 9));
    await tabsDao.put(stored('early', null, 1));
    await tabsDao.put(stored('orphan', 'gone', 5));
    await store.getState().load();
    const st = store.getState();
    expect(st.order).toEqual(['early', 'orphan', 'late']);
    expect(selectRoots(st).map((t) => t.id)).toEqual(['early', 'orphan']);
    expect(st.tabs['orphan']?.parentId).toBeNull();
  });
});

describe('remove', () => {
  it('cascades to the whole subtree and their row results', async () => {
    const a = create(null, 'a');
    const b = create(a, 'b');
    const c = create(b, 'c');
    const other = create(null, 'other');
    await store.getState().flush();
    for (const id of [a, b, c, other]) await rowResultsDao.put(id, [{ x: id }]);

    const removed = await store.getState().removeTab(a);
    expect(removed.sort()).toEqual([a, b, c].sort());
    const st = store.getState();
    expect(Object.keys(st.tabs)).toEqual([other]);
    expect(st.order).toEqual([other]);
    for (const id of [a, b, c]) {
      expect(await tabsDao.get(id)).toBeUndefined();
      expect(await rowResultsDao.get(id)).toEqual([]);
    }
    expect(await rowResultsDao.get(other)).toEqual([{ x: other }]);

    const fresh = await reload();
    expect(selectRoots(fresh.getState()).map((t) => t.id)).toEqual([other]);
  });

  it('removing a leaf keeps siblings; a pending save does not resurrect a removed tab', async () => {
    const a = create(null);
    const b = create(a);
    const c = create(a);
    store.getState().apply(b, retitled('pending')); // save still debounced
    await store.getState().removeTab(b);
    await store.getState().flush();
    expect(await tabsDao.get(b)).toBeUndefined();
    expect(selectChildrenOf(store.getState(), a).map((t) => t.id)).toEqual([c]);
  });

  it('unknown id is a no-op', async () => {
    expect(await store.getState().removeTab('nope')).toEqual([]);
  });
});

describe('errors', () => {
  it('toStoredError keeps only a serialisable {message, code}', () => {
    class ApiError extends Error {
      code = 'E_TIMEOUT';
      response = { circular: null as unknown };
      constructor() {
        super('boom');
        this.response.circular = this.response;
      }
    }
    const err = toStoredError(new ApiError());
    expect(err).toEqual({ message: 'boom', code: 'E_TIMEOUT' });
    expect(Object.getPrototypeOf(err)).toBe(Object.prototype);
    expect(toStoredError('x')).toEqual({ message: 'x' });
    expect(toStoredError(42)).toEqual({ message: '42' });
    expect(toStoredError({ foo: 1 })).toEqual({ message: '{"foo":1}' });
    expect(toStoredError(undefined)).toBeNull();
  });

  it('sanitises raw errors found in stored data on load', async () => {
    const a = create(null);
    await store.getState().flush();
    const raw = (await tabsDao.get(a))!;
    await tabsDao.put({
      ...raw,
      status: { ...raw.status, error: { message: 'm', stack: 's', extra: {} } as never },
    });
    const fresh = await reload();
    expect(fresh.getState().tabs[a]?.status.error).toEqual({ message: 'm' });
  });
});

describe('visited, reset', () => {
  it('marks visited and unvisited, skipping no-op writes', () => {
    const a = create(null);
    store.getState().markVisited(a);
    expect(store.getState().tabs[a]?.visited).toBe(true);
    const before = store.getState().tabs;
    store.getState().markVisited(a);
    expect(store.getState().tabs).toBe(before);
    store.getState().markUnvisited(a);
    expect(store.getState().tabs[a]?.visited).toBe(false);
  });

  it('reset empties the store', () => {
    create(null);
    act(() => store.reset());
    expect(store.getState().order).toEqual([]);
    expect(store.getState().loaded).toBe(false);
  });
});
