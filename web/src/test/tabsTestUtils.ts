import type {
  TabContent,
  TabLatestRun,
  TabResults,
  TabStatus,
  TabToRun,
  TabGrid,
} from '../lib/storage';
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

/** Changes to a tab's content, each group merged over the one it changes. */
export interface ContentOverrides {
  title?: string;
  toRun?: Partial<TabToRun>;
  latest?: Partial<TabLatestRun>;
  results?: TabResults | null;
  grid?: Partial<TabGrid>;
  status?: Partial<TabStatus>;
}

/** A tab of `acme.sign_ins` with no params, titled `title`, not run, with `over` merged on. */
export function content(title: string, over: ContentOverrides = {}): TabContent {
  return {
    title: over.title ?? title,
    toRun: { action: 'acme.sign_ins', params: {}, ...over.toRun },
    latest: { run: null, params: null, title: null, ...over.latest },
    results: over.results ?? null,
    grid: { gridState: null, columnView: null, ...over.grid },
    status: {
      executing: false,
      cancelling: false,
      error: null,
      paramErrors: null,
      linkedRow: null,
      pivotMissing: null,
      ...over.status,
    },
  };
}

/** Stored results of a run that succeeded with `rowCount` rows. */
export const results = (rowCount: number): TabResults => ({
  runId: 'r-1',
  columns: null,
  startedAt: '2026-10-20T10:00:00Z',
  rowCount,
});

/** The tab `id` under `parentId`, titled `T-<id>`, with `over` merged on its content. */
export const tab = (
  id: string,
  parentId: string | null = null,
  over: ContentOverrides = {},
): CreateTabArgs => ({ id, parentId, content: content(`T-${id}`, over) });
