import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  createColumnView,
  deleteColumnView,
  listColumnViews,
  replaceColumnView,
  setColumnViewHidden,
  type ColumnView,
  type ColumnViewFields,
  type NewColumnView,
} from '../../lib/api';

/** The `/api/columnViews` calls the store makes; tests pass their own. */
export interface SavedColumnViewsApi {
  list(): Promise<ColumnView[]>;
  create(view: NewColumnView): Promise<ColumnView>;
  replace(viewId: string, fields: ColumnViewFields): Promise<ColumnView>;
  remove(viewId: string): Promise<void>;
  setHidden(viewId: string, hidden: boolean): Promise<void>;
}

export interface SavedColumnViewsState {
  /** The analyst's own column views and the shared ones, oldest first. */
  views: ColumnView[];
  loaded: boolean;
  error: string | null;

  /** Refetches, so column views others shared since show up. Records the error instead of throwing. */
  refresh(): Promise<void>;
  /** Each change below throws on failure and leaves the list as it was. */
  create(view: NewColumnView): Promise<ColumnView>;
  replace(viewId: string, fields: ColumnViewFields): Promise<ColumnView>;
  remove(viewId: string): Promise<void>;
  setHidden(viewId: string, hidden: boolean): Promise<void>;
}

export type SavedColumnViewsStore = UseBoundStore<StoreApi<SavedColumnViewsState>>;

const defaultApi: SavedColumnViewsApi = {
  list: () => listColumnViews(),
  create: (view) => createColumnView(view),
  replace: (viewId, fields) => replaceColumnView(viewId, fields),
  remove: (viewId) => deleteColumnView(viewId),
  setHidden: (viewId, hidden) => setColumnViewHidden(viewId, hidden),
};

export function createSavedColumnViewsStore({
  api = defaultApi,
}: { api?: SavedColumnViewsApi } = {}): SavedColumnViewsStore {
  return create<SavedColumnViewsState>()((set, get) => {
    const put = (view: ColumnView) =>
      set({ views: get().views.map((v) => (v.viewId === view.viewId ? view : v)) });
    return {
      views: [],
      loaded: false,
      error: null,
      async refresh() {
        try {
          set({ views: await api.list(), loaded: true, error: null });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
        }
      },
      async create(view) {
        const created = await api.create(view);
        set({ views: [...get().views, created] });
        return created;
      },
      async replace(viewId, fields) {
        const view = await api.replace(viewId, fields);
        put(view);
        return view;
      },
      async remove(viewId) {
        await api.remove(viewId);
        set({ views: get().views.filter((v) => v.viewId !== viewId) });
      },
      async setHidden(viewId, hidden) {
        await api.setHidden(viewId, hidden);
        const view = get().views.find((v) => v.viewId === viewId);
        if (view) put({ ...view, hidden });
      },
    };
  });
}

/** App-wide singleton. */
export const useSavedColumnViewsStore = createSavedColumnViewsStore();
