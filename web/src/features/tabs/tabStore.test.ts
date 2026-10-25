import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayComponentsDao, resetTimDb, rowResultsDao } from '../../lib/storage';
import {
  createTabsStore,
  selectAncestors,
  selectChildrenOf,
  selectRoots,
  selectTab,
  toStoredError,
  type TabsStore,
} from './index';

const action = (parentUuid: string | null, title = 't', componentUuid?: string) =>
  ({
    componentName: 'ActionResult',
    parentUuid,
    title,
    componentUuid,
    params: { action: 'acme.sign_ins', params: { limit: 5 } },
  }) as const;

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
    const s = store.getState();
    const a = s.createTab(action(null, 'a'));
    const b = s.createTab(action(a, 'b'));
    const c = s.createTab(action(null, 'c'));
    const st = store.getState();
    expect(selectRoots(st).map((t) => t.componentUuid)).toEqual([a, c]);
    expect(selectChildrenOf(st, a).map((t) => t.componentUuid)).toEqual([b]);
    expect(selectAncestors(st, b).map((t) => t.componentUuid)).toEqual([a]);
    expect(selectTab(st, b)?.parentUuid).toBe(a);
    expect(st.lastCreated?.uuid).toBe(c);
    expect(st.tabs[a]?.state).toMatchObject({ isVisited: false, error: null, isExecuting: false });
  });

  it('ancestors path is root first', () => {
    const a = store.getState().createTab(action(null));
    const b = store.getState().createTab(action(a));
    const c = store.getState().createTab(action(b));
    expect(selectAncestors(store.getState(), c).map((t) => t.componentUuid)).toEqual([a, b]);
    expect(selectAncestors(store.getState(), a)).toEqual([]);
  });
});

describe('persistence', () => {
  it('debounces writes and coalesces updates', async () => {
    // Only the debounce timer is faked; fake-indexeddb needs the real setImmediate.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const idbPut = vi.spyOn(IDBObjectStore.prototype, 'put');
    const tabWrites = () =>
      idbPut.mock.contexts.filter(
        (store) => (store as IDBObjectStore).name === 'display_components',
      ).length;
    const a = store.getState().createTab(action(null));
    store.getState().updateTitle(a, 'x');
    store.getState().updateTitle(a, 'y');
    await vi.advanceTimersByTimeAsync(5);
    expect(tabWrites()).toBe(0);
    expect(await displayComponentsDao.get(a)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(20);
    await store.getState().flush();
    expect(tabWrites()).toBe(1);
    expect((await displayComponentsDao.get(a))?.title).toBe('y');
    idbPut.mockRestore();
  });

  it('reload preserves order, parents, titles and state', async () => {
    const s = store.getState();
    const a = s.createTab(action(null, 'a'));
    const b = s.createTab(action(a, 'b'));
    const c = s.createTab(action(null, 'c'));
    const d = s.createTab(action(b, 'd'));
    s.updateState(c, { rowCount: 5, isVisited: true });
    const fresh = await reload();
    const st = fresh.getState();
    expect(st.loaded).toBe(true);
    expect(st.order).toEqual([a, b, c, d]);
    expect(selectRoots(st).map((t) => t.title)).toEqual(['a', 'c']);
    expect(selectChildrenOf(st, b).map((t) => t.componentUuid)).toEqual([d]);
    expect(st.tabs[c]?.state).toMatchObject({ rowCount: 5, isVisited: true });
    expect(st.tabs[d]?.displayComponentIndex).toBe(3);
    // New tabs continue after the loaded ones, and a second reload keeps the order.
    const e = st.createTab(action(null, 'e'));
    const again = await (async () => {
      await fresh.getState().flush();
      const f = createTabsStore({ debounceMs: 10 });
      await f.getState().load();
      await f.getState().flush();
      return f;
    })();
    expect(again.getState().order).toEqual([a, b, c, d, e]);
  });

  it('load sorts by displayComponentIndex and turns a missing parent into a root', async () => {
    const base = {
      rowDataTrigger: null,
      state: { isVisited: false, error: null, rowCount: null, isExecuting: false },
    };
    const params = { action: 'acme.sign_ins', params: {} };
    const mk = (id: string, parent: string | null, idx: number) =>
      ({
        ...base,
        componentUuid: id,
        componentName: 'ActionResult',
        title: id,
        parentUuid: parent,
        displayComponentIndex: idx,
        params,
      }) as const;
    await displayComponentsDao.put(mk('late', 'early', 9));
    await displayComponentsDao.put(mk('early', null, 1));
    await displayComponentsDao.put(mk('orphan', 'gone', 5));
    await store.getState().load();
    const st = store.getState();
    expect(st.order).toEqual(['early', 'orphan', 'late']);
    expect(selectRoots(st).map((t) => t.componentUuid)).toEqual(['early', 'orphan']);
    expect(st.tabs['orphan']?.parentUuid).toBeNull();
  });

  it('load drops a stored tab of an unknown kind with its row results; its children become roots', async () => {
    const parent = store.getState().createTab(action(null, 'kept'));
    await store.getState().flush();
    const raw = (await displayComponentsDao.get(parent))!;
    await displayComponentsDao.put({
      ...raw,
      componentUuid: 'old',
      componentName: 'KustoQueryResult',
      parentUuid: null,
      displayComponentIndex: 0,
    } as never);
    await displayComponentsDao.put({ ...raw, componentUuid: 'child', parentUuid: 'old' });
    await rowResultsDao.put('old', [{ x: 1 }]);

    const fresh = await reload();
    const st = fresh.getState();
    expect(st.order.sort()).toEqual([parent, 'child'].sort());
    expect(st.tabs['child']?.parentUuid).toBeNull();
    expect(await displayComponentsDao.get('old')).toBeUndefined();
    expect(await rowResultsDao.get('old')).toEqual([]);
  });
});

describe('remove', () => {
  it('cascades to the whole subtree and their row results', async () => {
    const s = store.getState();
    const a = s.createTab(action(null, 'a'));
    const b = s.createTab(action(a, 'b'));
    const c = s.createTab(action(b, 'c'));
    const other = s.createTab(action(null, 'other'));
    await store.getState().flush();
    for (const id of [a, b, c, other]) await rowResultsDao.put(id, [{ x: id }]);

    const removed = await s.removeTab(a);
    expect(removed.sort()).toEqual([a, b, c].sort());
    const st = store.getState();
    expect(Object.keys(st.tabs)).toEqual([other]);
    expect(st.order).toEqual([other]);
    for (const id of [a, b, c]) {
      expect(await displayComponentsDao.get(id)).toBeUndefined();
      expect(await rowResultsDao.get(id)).toEqual([]);
    }
    expect(await rowResultsDao.get(other)).toEqual([{ x: other }]);

    const fresh = await reload();
    expect(selectRoots(fresh.getState()).map((t) => t.componentUuid)).toEqual([other]);
  });

  it('removing a leaf keeps siblings; a pending save does not resurrect a removed tab', async () => {
    const s = store.getState();
    const a = s.createTab(action(null));
    const b = s.createTab(action(a));
    const c = s.createTab(action(a));
    s.updateTitle(b, 'pending'); // save still debounced
    await s.removeTab(b);
    await store.getState().flush();
    expect(await displayComponentsDao.get(b)).toBeUndefined();
    expect(selectChildrenOf(store.getState(), a).map((t) => t.componentUuid)).toEqual([c]);
  });

  it('unknown uuid is a no-op', async () => {
    expect(await store.getState().removeTab('nope')).toEqual([]);
  });
});

describe('errors', () => {
  it('stores only serialisable {message, code}', async () => {
    class ApiError extends Error {
      code = 'E_TIMEOUT';
      response = { circular: null as unknown };
      constructor() {
        super('boom');
        this.response.circular = this.response;
      }
    }
    const a = store.getState().createTab(action(null));
    store.getState().updateState(a, { error: new ApiError() });
    const err = store.getState().tabs[a]?.state.error;
    expect(err).toEqual({ message: 'boom', code: 'E_TIMEOUT' });
    expect(Object.getPrototypeOf(err)).toBe(Object.prototype);
    await store.getState().flush();
    expect((await displayComponentsDao.get(a))?.state.error).toEqual({
      message: 'boom',
      code: 'E_TIMEOUT',
    });
    store.getState().updateState(a, { error: null });
    expect(store.getState().tabs[a]?.state.error).toBeNull();
    store.getState().updateState(a, { rowCount: 1 });
    expect(store.getState().tabs[a]?.state.error).toBeNull();
  });

  it('toStoredError handles strings, unknowns and odd objects', () => {
    expect(toStoredError('x')).toEqual({ message: 'x' });
    expect(toStoredError(42)).toEqual({ message: '42' });
    expect(toStoredError({ foo: 1 })).toEqual({ message: '{"foo":1}' });
    expect(toStoredError(undefined)).toBeNull();
  });

  it('sanitises raw errors found in stored data on load', async () => {
    const a = store.getState().createTab(action(null));
    await store.getState().flush();
    const raw = (await displayComponentsDao.get(a))!;
    await displayComponentsDao.put({
      ...raw,
      state: { ...raw.state, error: { message: 'm', stack: 's', extra: {} } as never },
    });
    const fresh = await reload();
    expect(fresh.getState().tabs[a]?.state.error).toEqual({ message: 'm' });
  });
});

describe('trigger, visited', () => {
  it('triggerRowData strictly increases and persists', async () => {
    const a = store.getState().createTab(action(null));
    const seen: Array<number | null> = [];
    const unsub = store.subscribe((s) => seen.push(s.tabs[a]?.rowDataTrigger ?? null));
    store.getState().triggerRowData(a);
    store.getState().triggerRowData(a);
    unsub();
    expect(seen[1]!).toBeGreaterThan(seen[0]!);
    await store.getState().flush();
    expect((await displayComponentsDao.get(a))?.rowDataTrigger).toBe(seen[1]);
  });

  it('marks visited and unvisited, skipping no-op writes', () => {
    const a = store.getState().createTab(action(null));
    store.getState().markVisited(a);
    expect(store.getState().tabs[a]?.state.isVisited).toBe(true);
    const before = store.getState().tabs;
    store.getState().markVisited(a);
    expect(store.getState().tabs).toBe(before);
    store.getState().markUnvisited(a);
    expect(store.getState().tabs[a]?.state.isVisited).toBe(false);
  });

  it('updateParams merges and reset empties the store', () => {
    const a = store.getState().createTab(action(null));
    store.getState().updateParams(a, { params: { limit: 10 } });
    expect(store.getState().tabs[a]?.params).toEqual({
      action: 'acme.sign_ins',
      params: { limit: 10 },
    });
    act(() => store.reset());
    expect(store.getState().order).toEqual([]);
    expect(store.getState().loaded).toBe(false);
  });
});
