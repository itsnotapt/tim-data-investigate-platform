/**
 * Entities persisted in the browser (IndexedDB database `tim`).
 * Source: docs/current-system/data-models.md "Browser entities";
 * store layout: docs/rewrite/target-architecture.md section 3.7.
 */

import type { TimeRange } from '../time-range';

export type DisplayComponentName = 'KustoQueryResult' | 'TemplateQueryResult';

/** Serialisable error only (BUG-38); never store Error instances. */
export interface StoredError {
  message: string;
  code?: string;
}

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
}

/** Custom Kusto query params. */
export interface KustoQueryParams {
  query: string;
  cluster: string;
  database: string;
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

/** A tab node without `children` (the tree is rebuilt in memory). */
export type DisplayComponent = KustoQueryDisplayComponent | TemplateQueryDisplayComponent;

/** One raw Kusto row. `_id` is client-only and never stored. */
export type RowResult = Record<string, unknown>;

/** Global named AG Grid column state. */
export interface ColumnView {
  /** Key (store `column_views`). */
  uuid: string;
  name: string;
  /** Raw AG Grid `getColumnState()` output. */
  columnState: unknown[];
}

/** Per-template options, keyed by template uuid. Other keys are allowed (legacy shallow-merge). */
export interface QueryOption {
  hide?: boolean;
  [key: string]: unknown;
}

export type QueryOptions = Record<string, QueryOption>;
