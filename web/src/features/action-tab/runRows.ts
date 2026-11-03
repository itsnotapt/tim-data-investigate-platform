import { create } from 'zustand';
import type { RunColumn, RunRow } from '../../lib/api';
import { useTabsStore } from '../tabs/tabStore';

/** The rows of a run loading, or loaded, in this session. */
export interface RunRows {
  runId: string;
  columns: RunColumn[] | null;
  /** The run's `rowCount`. */
  total: number;
  /** The rows so far, in order. */
  rows: readonly RunRow[];
  /** Every row has loaded and is stored in `row_results`. */
  done: boolean;
}

interface RunRowsState {
  /** By tab id. */
  byTab: Record<string, RunRows>;
  /** Starts the tab's rows for a run, replacing any it had. */
  start(tabId: string, runId: string, columns: RunColumn[] | null, total: number): void;
  /** Adds a page to the tab's rows of `runId`; ignored once another run has started. */
  append(tabId: string, runId: string, page: readonly RunRow[]): void;
  finish(tabId: string, runId: string): void;
  drop(tabId: string): void;
  clear(): void;
}

/**
 * The rows of the runs the tabs follow, page by page, so the grid fills while the rest load. A
 * reload loses them; the tab then reads its rows from `row_results`.
 */
export const runRowsStore = create<RunRowsState>()((set) => {
  const update = (tabId: string, runId: string, change: (r: RunRows) => Partial<RunRows>) =>
    set((s) => {
      const current = s.byTab[tabId];
      if (current?.runId !== runId) return s;
      return { byTab: { ...s.byTab, [tabId]: { ...current, ...change(current) } } };
    });
  return {
    byTab: {},
    start: (tabId, runId, columns, total) =>
      set((s) => ({
        byTab: { ...s.byTab, [tabId]: { runId, columns, total, rows: [], done: false } },
      })),
    append: (tabId, runId, page) => update(tabId, runId, (r) => ({ rows: [...r.rows, ...page] })),
    finish: (tabId, runId) => update(tabId, runId, () => ({ done: true })),
    drop: (tabId) =>
      set((s) => {
        if (!(tabId in s.byTab)) return s;
        const byTab = { ...s.byTab };
        delete byTab[tabId];
        return { byTab };
      }),
    clear: () => set({ byTab: {} }),
  };
});

export const useRunRows = (tabId: string): RunRows | undefined =>
  runRowsStore((s) => s.byTab[tabId]);

// A closed tab's rows are let go.
useTabsStore.subscribe(({ tabs }) => {
  for (const tabId of Object.keys(runRowsStore.getState().byTab)) {
    if (!(tabId in tabs)) runRowsStore.getState().drop(tabId);
  }
});
