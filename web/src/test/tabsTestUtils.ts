import {
  createTabsStore,
  type CreateTabArgs,
  type TabPersistence,
  type TabsStore,
} from '../features/tabs';

/** In-memory persistence so component tests do not touch IndexedDB. */
const memoryPersistence: TabPersistence = {
  loadAll: () => Promise.resolve([]),
  save: () => Promise.resolve(),
  remove: () => Promise.resolve(),
};

export const newTestStore = (): TabsStore =>
  createTabsStore({ persistence: memoryPersistence, debounceMs: 1 });

export const kusto = (
  componentUuid: string,
  parentUuid: string | null = null,
  extra: Partial<CreateTabArgs> = {},
): CreateTabArgs =>
  ({
    componentName: 'KustoQueryResult',
    componentUuid,
    parentUuid,
    title: `T-${componentUuid}`,
    params: { query: 'T', cluster: '', database: '' },
    ...extra,
  }) as CreateTabArgs;
