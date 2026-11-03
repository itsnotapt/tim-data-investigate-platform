import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { generateUuid } from '../../lib/uuid';
import { toStoredError } from './errors';
import { indexedDbTabPersistence, PersistQueue, type TabPersistence } from './persistence';
import { selectSubtreeIds } from './selectors';
import type { CreateTabArgs, Tab, TabTreeFields, Transition } from './types';

/**
 * The tree of tabs and its persistence. What is inside a tab is the action tab module's
 * (`features/action-tab/model.ts`); the store changes it only through `apply`.
 */
interface TabsState {
  tabs: Record<string, Tab>;
  /** Tab ids in load/creation order; parents always precede children. */
  order: string[];
  /** Next `index` (renumbered on every load). */
  nextIndex: number;
  loaded: boolean;
  loadError: string | null;
  /** Signal: bumps whenever a tab is created. */
  lastCreated: { id: string; seq: number } | null;

  load(): Promise<void>;
  /** Adds a tab under `parentId` and returns its id. */
  createTab(args: CreateTabArgs): string;
  /** Changes the tab's content; its place in the tree, visited mark and row trigger stay. */
  apply(id: string, transition: Transition): void;
  /** Bump the tab's `rowDataTrigger`; grids subscribe to it and reload rows from IndexedDB. */
  triggerRowData(id: string): void;
  markVisited(id: string): void;
  markUnvisited(id: string): void;
  /** Removes the tab, its whole subtree and all their row results. Returns the removed ids. */
  removeTab(id: string): Promise<string[]>;
  /** Write pending changes now. */
  flush(): Promise<void>;
}

export interface TabsStoreOptions {
  persistence?: TabPersistence;
  /** Debounce for writes. Default 300 ms. */
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
  return { ...tab, status: { ...tab.status, error: toStoredError(tab.status.error) } };
}

function treeFields(tab: Tab): TabTreeFields {
  const { id, parentId, index, visited, rowDataTrigger } = tab;
  return { id, parentId, index, visited, rowDataTrigger };
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
    /** Replace a tab, then schedule a save. */
    const patch = (id: string, fn: (tab: Tab) => Tab): void => {
      const tab = get().tabs[id];
      if (!tab) return;
      set({ tabs: { ...get().tabs, [id]: fn(tab) } });
      queue.schedule(id);
    };

    return {
      ...initialData,

      async load() {
        try {
          await queue.flush();
          const stored = await persistence.loadAll();
          // Parents before children, as stored.
          stored.sort((a, b) => a.index - b.index);
          const ids = new Set(stored.map((t) => t.id));
          const tabs: Record<string, Tab> = {};
          const order: string[] = [];
          stored.forEach((raw, index) => {
            if (raw.id in tabs) return;
            const tab = sanitize(raw);
            tabs[tab.id] = {
              ...tab,
              // A missing parent makes the tab a root.
              parentId: tab.parentId !== null && ids.has(tab.parentId) ? tab.parentId : null,
              index,
            };
            order.push(tab.id);
          });
          set({ tabs, order, nextIndex: order.length, loaded: true, loadError: null });
          // Indexes were renumbered; persist them.
          for (const id of order) queue.schedule(id);
        } catch (e) {
          set({ loaded: true, loadError: toStoredError(e)?.message ?? 'Failed to load tabs' });
        }
      },

      createTab({ id = generateUuid(), parentId, content }) {
        const state = get();
        const tab: Tab = {
          ...content,
          id,
          parentId,
          index: state.nextIndex,
          visited: false,
          rowDataTrigger: null,
        };
        set({
          tabs: { ...state.tabs, [id]: tab },
          order: [...state.order.filter((other) => other !== id), id],
          nextIndex: state.nextIndex + 1,
          lastCreated: { id, seq: ++seq },
        });
        queue.schedule(id);
        return id;
      },

      apply(id, transition) {
        patch(id, (tab) => ({ ...transition(tab), ...treeFields(tab) }));
      },

      triggerRowData(id) {
        patch(id, (tab) => {
          // Strictly increasing even within the same millisecond.
          lastTrigger = Math.max(Date.now(), lastTrigger + 1, (tab.rowDataTrigger ?? 0) + 1);
          return { ...tab, rowDataTrigger: lastTrigger };
        });
      },

      markVisited(id) {
        if (get().tabs[id]?.visited === false) patch(id, (tab) => ({ ...tab, visited: true }));
      },

      markUnvisited(id) {
        if (get().tabs[id]?.visited === true) patch(id, (tab) => ({ ...tab, visited: false }));
      },

      async removeTab(id) {
        const removed = selectSubtreeIds(get(), id);
        if (removed.length === 0) return [];
        const gone = new Set(removed);
        const tabs = { ...get().tabs };
        for (const other of removed) delete tabs[other];
        set({ tabs, order: get().order.filter((other) => !gone.has(other)) });
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
