import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { listTemplates, type QueryTemplate } from '../../lib/api';
import { queryOptionsDao, type QueryOptions, type QueryOption } from '../../lib/storage';

export interface TemplatesState {
  /** Non-deleted templates as returned by the API (each satisfies the kql-templates `QueryTemplate`). */
  templates: QueryTemplate[];
  /** Per-template local options (IndexedDB `query_options`). */
  queryOptions: QueryOptions;
  loaded: boolean;
  loading: boolean;
  error: string | null;

  /** Fetch once; later calls resolve immediately (legacy `loadQueries`). Throws on failure. */
  load(): Promise<void>;
  /** Force a refetch (legacy `reloadQueries`). Throws on failure. */
  reload(): Promise<void>;
  upsert(template: QueryTemplate): void;
  remove(uuid: string): void;
  setQueryOption(uuid: string, option: QueryOption): Promise<void>;
}

export interface TemplatesStoreOptions {
  fetchTemplates?: () => Promise<QueryTemplate[]>;
  loadQueryOptions?: () => Promise<QueryOptions>;
  saveQueryOption?: (uuid: string, option: QueryOption) => Promise<void>;
}

export type TemplatesStore = UseBoundStore<StoreApi<TemplatesState>> & { reset(): void };

const initial = {
  templates: [] as QueryTemplate[],
  queryOptions: {} as QueryOptions,
  loaded: false,
  loading: false,
  error: null,
};

export function createTemplatesStore(options: TemplatesStoreOptions = {}): TemplatesStore {
  const fetchTemplates = options.fetchTemplates ?? (() => listTemplates());
  const loadQueryOptions = options.loadQueryOptions ?? (() => queryOptionsDao.getAll());
  const saveQueryOption =
    options.saveQueryOption ?? ((uuid, option) => queryOptionsDao.put(uuid, option));

  let inflight: Promise<void> | null = null;

  const useStore = create<TemplatesState>()((set, get) => {
    const run = (): Promise<void> => {
      // Concurrent callers share one request.
      inflight ??= (async () => {
        set({ loading: true, error: null });
        try {
          const [templates, queryOptions] = await Promise.all([
            fetchTemplates(),
            loadQueryOptions(),
          ]);
          set({
            templates: templates.filter((t) => t.isDeleted !== true),
            queryOptions,
            loaded: true,
            loading: false,
          });
        } catch (e) {
          set({ loading: false, error: e instanceof Error ? e.message : String(e) });
          throw e;
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    };

    return {
      ...initial,
      load: () => (get().loaded ? Promise.resolve() : run()),
      reload: run,
      upsert(template) {
        const rest = get().templates.filter((t) => t.uuid !== template.uuid);
        set({ templates: template.isDeleted ? rest : [...rest, template] });
      },
      remove(uuid) {
        set({ templates: get().templates.filter((t) => t.uuid !== uuid) });
      },
      async setQueryOption(uuid, option) {
        const next = { ...get().queryOptions[uuid], ...option };
        await saveQueryOption(uuid, next);
        set({ queryOptions: { ...get().queryOptions, [uuid]: next } });
      },
    };
  });

  const store = useStore as TemplatesStore;
  store.reset = () => {
    inflight = null;
    useStore.setState({ ...initial });
  };
  return store;
}

/** App-wide singleton. */
export const useTemplatesStore = createTemplatesStore();
