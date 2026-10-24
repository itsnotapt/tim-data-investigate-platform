/**
 * Entities persisted in the browser (IndexedDB database `tim`).
 */

import type { GridState } from 'ag-grid-community';
import type { Run, RunColumn } from '../api/runs';
import type { TimeRange } from '../time-range';

export type DisplayComponentName = 'KustoQueryResult' | 'TemplateQueryResult' | 'ActionResult';

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
  /** Template components only. */
  editQuery?: boolean;
  /** Kusto components only: the picked time range (resolved at run time). Default Last 15 minutes. */
  timeRange?: TimeRange;
  executionTime?: number | null;
  cpuUsage?: string | null;
  memoryUsage?: string | null;
  /** Action tabs only: the envelope of the latest run, picked up again by `runId`. */
  run?: Run | null;
  /** Action tabs only: a cancel was asked for and the run has not ended yet. */
  cancelling?: boolean;
  /** Action tabs only: why each param was refused when the run could not start, by name. */
  paramErrors?: ParamErrors | null;
  /** Action tabs only: the plain params the latest run started with. */
  runParams?: Record<string, unknown> | null;
  /** Action tabs only: the run whose rows are in `row_results`. */
  resultsRunId?: string | null;
  /** Action tabs only: the columns of that run. */
  resultColumns?: RunColumn[] | null;
  /** Action tabs only: when that run started. */
  resultsStartedAt?: string | null;
  /**
   * Action tabs only: the params a pivot left missing, by name, each with the reason or `null`.
   * Cleared when a run starts.
   */
  pivotMissing?: Record<string, string | null> | null;
  /**
   * Action tabs only: the column and filter sections of the tab's grid state, as the analyst last
   * left them, in the shape of a column view's state.
   */
  gridState?: GridState | null;
  /** Action tabs only: the column view the tab started from or last picked. */
  columnView?: TabColumnView | null;
}

/** The column view an action tab started from or last picked, and its state at that point. */
export interface TabColumnView {
  /** `null` for the action default. */
  viewId: string | null;
  name: string;
  /** The tab's grid state just after the view was put on it, to tell whether it's modified. */
  baseline: GridState;
}

/** Custom Kusto query params. */
export interface KustoQueryParams {
  query: string;
  cluster: string;
  database: string;
}

/** Action component params: the action's key and plain param values, never re-resolved. */
export interface ActionParams {
  action: string;
  params: Record<string, unknown>;
  /** The preset the tab was opened from or last saved as, which Save… offers to update. */
  presetId?: string;
}

/** Template component params: user inputs plus a full template snapshot (not a reference). */
export interface TemplateQueryParams {
  inParams: Record<string, unknown>;
  queryTemplate: Record<string, unknown>;
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

export interface KustoQueryDisplayComponent extends DisplayComponentBase {
  componentName: 'KustoQueryResult';
  params: KustoQueryParams;
}

export interface TemplateQueryDisplayComponent extends DisplayComponentBase {
  componentName: 'TemplateQueryResult';
  params: TemplateQueryParams;
}

export interface ActionDisplayComponent extends DisplayComponentBase {
  componentName: 'ActionResult';
  params: ActionParams;
}

/** A tab node without `children` (the tree is rebuilt in memory). */
export type DisplayComponent =
  KustoQueryDisplayComponent | TemplateQueryDisplayComponent | ActionDisplayComponent;

/**
 * One stored row: a raw Kusto row (`_id` is client-only and never stored), or for action
 * components a run row `{row, id, data}`.
 */
export type RowResult = Record<string, unknown>;

/** Global named AG Grid column state, for template and Kusto tabs. */
export interface ColumnView {
  /** Key (store `column_views`). */
  uuid: string;
  name: string;
  /** Raw AG Grid `getColumnState()` output. */
  columnState: unknown[];
}

/**
 * The column view an analyst applied for new tabs from a preset or action, in this browser. Key
 * (store `applied_views`) = `[analyst, scope]`.
 */
export interface AppliedView {
  /** The analyst's user principal name. */
  analyst: string;
  /** `preset:<presetId>` or `action:<key>`. */
  scope: string;
  viewId: string;
  /** The view's name when it was applied, for the warning if it's gone. */
  name: string;
}

/** Per-template options, keyed by template uuid. Other keys are allowed. */
export interface QueryOption {
  hide?: boolean;
  [key: string]: unknown;
}

export type QueryOptions = Record<string, QueryOption>;
