import { create } from 'zustand';
import { columnViewsDao, type ColumnView } from '../../lib/storage';
import { generateUuid } from '../../lib/uuid';

export interface ColumnViewsState {
  /** Sorted by name. */
  views: ColumnView[];
  loaded: boolean;
  load(): Promise<void>;
  /** Persists a new view and returns its uuid. */
  add(name: string, columnState: unknown[]): Promise<string>;
  /** Overwrites the stored column state of a view. */
  saveState(uuid: string, columnState: unknown[]): Promise<void>;
  rename(uuid: string, name: string): Promise<void>;
  remove(uuid: string): Promise<void>;
}

const byName = (a: ColumnView, b: ColumnView) => a.name.localeCompare(b.name);

/**
 * Global named column layouts, persisted in IndexedDB (`column_views`). State is updated only
 * after the DAO write succeeds, so a failed write never shows a view that is not stored.
 */
export const useColumnViewsStore = create<ColumnViewsState>()((set, get) => ({
  views: [],
  loaded: false,
  async load() {
    set({ views: await columnViewsDao.list(), loaded: true });
  },
  async add(name, columnState) {
    const view: ColumnView = { uuid: generateUuid(), name: name.trim(), columnState };
    await columnViewsDao.put(view);
    set({ views: [...get().views, view].sort(byName) });
    return view.uuid;
  },
  async saveState(uuid, columnState) {
    const existing = get().views.find((v) => v.uuid === uuid);
    if (!existing) return;
    const updated = { ...existing, columnState };
    await columnViewsDao.put(updated);
    set({ views: get().views.map((v) => (v.uuid === uuid ? updated : v)) });
  },
  async rename(uuid, name) {
    const updated = await columnViewsDao.rename(uuid, name.trim());
    if (!updated) return;
    set({
      views: get()
        .views.map((v) => (v.uuid === uuid ? updated : v))
        .sort(byName),
    });
  },
  async remove(uuid) {
    await columnViewsDao.delete(uuid);
    set({ views: get().views.filter((v) => v.uuid !== uuid) });
  },
}));

export const loadColumnViews = (): Promise<void> => useColumnViewsStore.getState().load();
