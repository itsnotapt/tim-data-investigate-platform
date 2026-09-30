import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { generateUuid } from '../../lib/uuid';
import { toStoredError } from './errors';
import { indexedDbTabPersistence, PersistQueue, type TabPersistence } from './persistence';
import { selectSubtreeUuids } from './selectors';
import {
  DEFAULT_TAB_STATE,
  type CreateTabArgs,
  type KustoQueryParams,
  type Tab,
  type TabState,
  type TabStateUpdate,
  type TemplateQueryParams,
} from './types';

export interface TabsState {
  tabs: Record<string, Tab>;
  /** Uuids in load/creation order; parents always precede children. */
  order: string[];
  /** Next `displayComponentIndex` (renumbered on every load, as legacy). */
  nextIndex: number;
  loaded: boolean;
  loadError: string | null;
  /** Signal: bumps whenever a tab is created (replaces legacy `new:display-component`). */
  lastCreated: { uuid: string; seq: number } | null;

  load(): Promise<void>;
  createTab(args: CreateTabArgs): string;
  updateState(uuid: string, update: TabStateUpdate): void;
  updateParams(
    uuid: string,
    params: Partial<KustoQueryParams> | Partial<TemplateQueryParams>,
  ): void;
  updateTitle(uuid: string, title: string): void;
  /** Template tab becomes a Kusto tab; uuid, parent and row results are kept. */
  convertToKusto(uuid: string, params: KustoQueryParams, state?: Partial<TabState>): void;
  /** Bump the tab's `rowDataTrigger`; grids subscribe to it and reload rows from IndexedDB. */
  triggerRowData(uuid: string): void;
  markVisited(uuid: string): void;
  markUnvisited(uuid: string): void;
  /** Removes the tab, its whole subtree and all their row results. Returns the removed uuids. */
  removeTab(uuid: string): Promise<string[]>;
  /** Write pending changes now. */
  flush(): Promise<void>;
}

export interface TabsStoreOptions {
  persistence?: TabPersistence;
  /** Debounce for state/param/title writes. Default 300 ms. */
  debounceMs?: number;
}

export type TabsStore = UseBoundStore<StoreApi<TabsState>> & {
  /** Test helper: empty the in-memory state and drop pending writes (storage untouched). */
  reset(): void;
};

const initialData = {
  tabs: {} as Record<string, Tab>,
  order: [] as string[],
  nextIndex: 0,
  loaded: false,
  loadError: null,
  lastCreated: null,
};

function sanitize(tab: Tab): Tab {
  return { ...tab, state: { ...tab.state, error: toStoredError(tab.state.error) } };
}

export function createTabsStore(options: TabsStoreOptions = {}): TabsStore {
  const persistence = options.persistence ?? indexedDbTabPersistence;
  let seq = 0;
  let lastTrigger = 0;

  const queue = new PersistQueue(
    persistence,
    (id) => useStore.getState().tabs[id],
    options.debounceMs ?? 300,
  );

  const useStore: UseBoundStore<StoreApi<TabsState>> = create<TabsState>()((set, get) => {
    /** Shallow-patch a tab, keeping the discriminated union intact, then schedule a save. */
    const patch = (uuid: string, fn: (tab: Tab) => Tab): void => {
      const tab = get().tabs[uuid];
      if (!tab) return;
      set({ tabs: { ...get().tabs, [uuid]: fn(tab) } });
      queue.schedule(uuid);
    };

    return {
      ...initialData,

      async load() {
        try {
          await queue.flush();
          const stored = await persistence.loadAll();
          // Parents before children, as stored.
          stored.sort((a, b) => a.displayComponentIndex - b.displayComponentIndex);
          const ids = new Set(stored.map((t) => t.componentUuid));
          const tabs: Record<string, Tab> = {};
          const order: string[] = [];
          stored.forEach((raw, index) => {
            if (raw.componentUuid in tabs) return;
            const tab = sanitize(raw);
            tabs[tab.componentUuid] = {
              ...tab,
              // A missing parent makes the tab a root (legacy behaviour).
              parentUuid:
                tab.parentUuid !== null && ids.has(tab.parentUuid) ? tab.parentUuid : null,
              displayComponentIndex: index,
            };
            order.push(tab.componentUuid);
          });
          set({ tabs, order, nextIndex: order.length, loaded: true, loadError: null });
          // Indexes were renumbered; persist them (legacy re-saves on load).
          for (const id of order) queue.schedule(id);
        } catch (e) {
          set({ loaded: true, loadError: toStoredError(e)?.message ?? 'Failed to load tabs' });
        }
      },

      createTab(args) {
        const uuid = args.componentUuid ?? generateUuid();
        const state = get();
        const base = {
          componentUuid: uuid,
          parentUuid: args.parentUuid,
          title: args.title,
          rowDataTrigger: null,
          displayComponentIndex: state.nextIndex,
          state: {
            ...DEFAULT_TAB_STATE,
            ...args.state,
            error: toStoredError(args.state?.error),
          },
        };
        const tab: Tab =
          args.componentName === 'KustoQueryResult'
            ? { ...base, componentName: 'KustoQueryResult', params: args.params }
            : { ...base, componentName: 'TemplateQueryResult', params: args.params };
        set({
          tabs: { ...state.tabs, [uuid]: tab },
          order: [...state.order.filter((id) => id !== uuid), uuid],
          nextIndex: state.nextIndex + 1,
          lastCreated: { uuid, seq: ++seq },
        });
        queue.schedule(uuid);
        return uuid;
      },

      updateState(uuid, update) {
        patch(uuid, (tab) => {
          const { error, ...rest } = update;
          const next: TabState = { ...tab.state, ...rest };
          if ('error' in update) next.error = toStoredError(error);
          return { ...tab, state: next };
        });
      },

      updateParams(uuid, params) {
        patch(uuid, (tab) => ({ ...tab, params: { ...tab.params, ...params } }) as Tab);
      },

      updateTitle(uuid, title) {
        patch(uuid, (tab) => ({ ...tab, title }));
      },

      convertToKusto(uuid, params, state) {
        if (get().tabs[uuid]?.componentName !== 'TemplateQueryResult') return;
        patch(uuid, (tab) => ({
          ...tab,
          componentName: 'KustoQueryResult',
          params,
          state: { ...DEFAULT_TAB_STATE, ...state, error: toStoredError(state?.error) },
        }));
      },

      triggerRowData(uuid) {
        patch(uuid, (tab) => {
          // Strictly increasing even within the same millisecond.
          lastTrigger = Math.max(Date.now(), lastTrigger + 1, (tab.rowDataTrigger ?? 0) + 1);
          return { ...tab, rowDataTrigger: lastTrigger };
        });
      },

      markVisited(uuid) {
        if (get().tabs[uuid]?.state.isVisited === false) {
          patch(uuid, (tab) => ({ ...tab, state: { ...tab.state, isVisited: true } }));
        }
      },

      markUnvisited(uuid) {
        if (get().tabs[uuid]?.state.isVisited === true) {
          patch(uuid, (tab) => ({ ...tab, state: { ...tab.state, isVisited: false } }));
        }
      },

      async removeTab(uuid) {
        const removed = selectSubtreeUuids(get(), uuid);
        if (removed.length === 0) return [];
        const gone = new Set(removed);
        const tabs = { ...get().tabs };
        for (const id of removed) delete tabs[id];
        set({ tabs, order: get().order.filter((id) => !gone.has(id)) });
        await queue.remove(removed);
        return removed;
      },

      flush: () => queue.flush(),
    };
  });

  const store = useStore as TabsStore;
  store.reset = () => {
    queue.discard();
    useStore.setState({ ...initialData });
  };
  return store;
}

/** App-wide singleton, persisted to IndexedDB. */
export const useTabsStore = createTabsStore();
