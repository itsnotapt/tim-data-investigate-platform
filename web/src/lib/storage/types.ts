/**
 * Entities persisted in the browser (IndexedDB database `tim`).
 */

import type { GridState } from 'ag-grid-community';
import type { Run, RunColumn } from '../api/runs';

/** Serialisable error only; never store Error instances. */
export interface StoredError {
  message: string;
  code?: string;
}

/** Why each param was refused, by param name. */
export type ParamErrors = Record<string, string>;

/** The column view an action tab started from or last picked, and its state at that point. */
export interface TabColumnView {
  /** `null` for the Built-in view. */
  viewId: string | null;
  name: string;
  /** The tab's grid state just after the view was put on it, to tell whether it's modified. */
  baseline: GridState;
}

/** An input of a preset whose value a preset tab shows in its title: a param or a query parameter. */
export interface TitleInput {
  source: 'param' | 'queryParameter';
  name: string;
}

/** What an action tab runs: its action and param values, and where they came from. */
export interface TabToRun {
  /** The action's key. */
  action: string;
  /** The plain param values, as the browser sends them; never resolved again. */
  params: Record<string, unknown>;
  /** The preset the tab was opened from or last saved as, which Save… offers to update. */
  presetId?: string;
  /**
   * A preset tab's inputs shown in its title, in order, as the preset had them when the tab opened
   * from it or was saved as it.
   */
  titleInputs?: TitleInput[];
  /**
   * The rows the tab was pivoted from, each with only the columns its action's title names, for
   * its runs' titles. Editing a param drops them.
   */
  pivotRows?: Record<string, unknown>[];
  /** The `id`s of the pivot rows, each `null` for a row without one. Kept across runs and edits. */
  pivotRowIds?: (string | null)[];
}

/** The tab's latest run. */
export interface TabLatestRun {
  /** Its envelope, picked up again by `runId`; `null` from a run start until it has one. */
  run: Run | null;
  /** The plain params it started with. */
  params: Record<string, unknown> | null;
  /** Its title, kept while the next run starts. */
  title: string | null;
}

/** The run whose rows are stored in `row_results`. */
export interface TabResults {
  runId: string;
  columns: RunColumn[] | null;
  /** When that run started. */
  startedAt: string;
  rowCount: number;
}

/** How the tab shows its results. */
export interface TabView {
  /**
   * The column and filter sections of the tab's grid state, as the analyst last left them, in the
   * shape of a column view's state.
   */
  gridState: GridState | null;
  /** The column view the tab started from or last picked. */
  columnView: TabColumnView | null;
  /** The Id column the tab uses over the action's: its preset's, or the one the analyst switched to. */
  idColumn?: string;
}

/** What the tab is doing, and what it waits for. */
export interface TabStatus {
  executing: boolean;
  /** A cancel was asked for and the run has not ended yet. */
  cancelling: boolean;
  error: StoredError | null;
  /** Why each param was refused when the run could not start, by name. */
  paramErrors: ParamErrors | null;
  /**
   * The row a share link named, focused with Row detail open on it once the run's rows show.
   * Cleared then, and when the run ends without success, when the stored rows lack that row, or
   * when a new run of the tab starts.
   */
  linkedRow: number | null;
  /**
   * The params a pivot or preset left missing, by name, each with the reason or `null`. Cleared
   * when a run starts.
   */
  pivotMissing: Record<string, string | null> | null;
}

/** What is inside a tab. Only the action tab module changes it. */
export interface TabContent {
  title: string;
  toRun: TabToRun;
  latest: TabLatestRun;
  results: TabResults | null;
  view: TabView;
  status: TabStatus;
}

/** A tab: its place in the tree, which only the tabs store changes, and its content. */
export interface Tab extends TabContent {
  /** Key (store `tabs`). */
  id: string;
  /** `null` = root. */
  parentId: string | null;
  /** Load-order counter; parents sort before children. */
  index: number;
  visited: boolean;
  /** Bumped when the tab's stored rows change; grids reload them from IndexedDB. */
  rowDataTrigger: number | null;
}

/** One stored row: a row of the tab's run, `{row, id, data}`. */
export type RowResult = Record<string, unknown>;

/**
 * The default view an analyst chose for new tabs from a preset or action, in this browser. Key
 * (store `applied_views`) = `[analyst, scope]`.
 */
export interface DefaultView {
  /** The analyst's user principal name. */
  analyst: string;
  /** `preset:<presetId>` or `action:<key>`. */
  scope: string;
  viewId: string;
  /** The view's name when it was made the default, for the warning if it's gone. */
  name: string;
}
