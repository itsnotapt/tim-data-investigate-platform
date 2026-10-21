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
  /** By tab uuid. */
  byTab: Record<string, RunRows>;
  /** Starts the tab's rows for a run, replacing any it had. */
  start(uuid: string, runId: string, columns: RunColumn[] | null, total: number): void;
  /** Adds a page to the tab's rows of `runId`; ignored once another run has started. */
  append(uuid: string, runId: string, page: readonly RunRow[]): void;
  finish(uuid: string, runId: string): void;
  drop(uuid: string): void;
  clear(): void;
}

/**
 * The rows of the runs the tabs follow, page by page, so the grid fills while the rest load. A
 * reload loses them; the tab then reads its rows from `row_results`.
 */
export const runRowsStore = create<RunRowsState>()((set) => {
  const update = (uuid: string, runId: string, change: (r: RunRows) => Partial<RunRows>) =>
    set((s) => {
      const current = s.byTab[uuid];
      if (current?.runId !== runId) return s;
      return { byTab: { ...s.byTab, [uuid]: { ...current, ...change(current) } } };
    });
  return {
    byTab: {},
    start: (uuid, runId, columns, total) =>
      set((s) => ({
        byTab: { ...s.byTab, [uuid]: { runId, columns, total, rows: [], done: false } },
      })),
    append: (uuid, runId, page) => update(uuid, runId, (r) => ({ rows: [...r.rows, ...page] })),
    finish: (uuid, runId) => update(uuid, runId, () => ({ done: true })),
    drop: (uuid) =>
      set((s) => {
        if (!(uuid in s.byTab)) return s;
        const byTab = { ...s.byTab };
        delete byTab[uuid];
        return { byTab };
      }),
    clear: () => set({ byTab: {} }),
  };
});

export const useRunRows = (uuid: string): RunRows | undefined => runRowsStore((s) => s.byTab[uuid]);

// A closed tab's rows are let go.
useTabsStore.subscribe(({ tabs }) => {
  for (const uuid of Object.keys(runRowsStore.getState().byTab)) {
    if (!(uuid in tabs)) runRowsStore.getState().drop(uuid);
  }
});
