/**
 * Entities persisted in the browser (IndexedDB database `tim`).
 */

import type { GridState } from 'ag-grid-community';
import type { Run, RunColumn } from '../api/runs';

export type DisplayComponentName = 'ActionResult';

/** Serialisable error only; never store Error instances. */
export interface StoredError {
  message: string;
  code?: string;
}

/** Why each param was refused, by param name. */
export type ParamErrors = Record<string, string>;

export interface DisplayComponentState {
  isVisited: boolean;
  error: StoredError | null;
  rowCount: number | null;
  isExecuting: boolean;
  /** The envelope of the latest run, picked up again by `runId`. */
  run?: Run | null;
  /** A cancel was asked for and the run has not ended yet. */
  cancelling?: boolean;
  /** Why each param was refused when the run could not start, by name. */
  paramErrors?: ParamErrors | null;
  /** The plain params the latest run started with. */
  runParams?: Record<string, unknown> | null;
  /** The run whose rows are in `row_results`. */
  resultsRunId?: string | null;
  /** The columns of that run. */
  resultColumns?: RunColumn[] | null;
  /** When that run started. */
  resultsStartedAt?: string | null;
  /**
   * The params a pivot left missing, by name, each with the reason or `null`.
   * Cleared when a run starts.
   */
  pivotMissing?: Record<string, string | null> | null;
  /**
   * The column and filter sections of the tab's grid state, as the analyst last
   * left them, in the shape of a column view's state.
   */
  gridState?: GridState | null;
  /** The column view the tab started from or last picked. */
  columnView?: TabColumnView | null;
  /**
   * The row a share link named, focused with Row detail open on it once the run's
   * rows show. Cleared then, and also when the run ends without success, when the stored rows
   * lack that row, or when a new run of the tab starts.
   */
  linkedRow?: number | null;
}

/** The column view an action tab started from or last picked, and its state at that point. */
export interface TabColumnView {
  /** `null` for the Built-in view. */
  viewId: string | null;
  name: string;
  /** The tab's grid state just after the view was put on it, to tell whether it's modified. */
  baseline: GridState;
}

/** Action component params: the action's key and plain param values, never re-resolved. */
export interface ActionParams {
  action: string;
  params: Record<string, unknown>;
  /** The preset the tab was opened from or last saved as, which Save… offers to update. */
  presetId?: string;
}

interface DisplayComponentBase {
  /** Key (store `display_components`). */
  componentUuid: string;
  title: string;
  /** `null` = root. */
  parentUuid: string | null;
  rowDataTrigger: number | null;
  /** Load-order counter; parents sort before children. */
  displayComponentIndex: number;
  state: DisplayComponentState;
}

export interface ActionDisplayComponent extends DisplayComponentBase {
  componentName: 'ActionResult';
  params: ActionParams;
}

/** A tab node without `children` (the tree is rebuilt in memory). */
export type DisplayComponent = ActionDisplayComponent;

/** One stored row: an action run row `{row, id, data}`. */
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
