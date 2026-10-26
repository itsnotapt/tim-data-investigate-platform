import type { ColDef } from 'ag-grid-community';
import { stringifyJson } from '../../lib/json';

/** Row as stored (raw column name to value). */
export type GridRow = Record<string, unknown>;
/** A grid row with its row number `row`, the AG Grid row id. */
export type GridRowWithId = GridRow & { row: number };

/** The AG Grid row id of a row: its row number. */
export const gridRowId = (row: { row: number }): string => String(row.row);

/** Text of a cell value: objects as JSON, other values via `String`. */
export function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return stringifyJson(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  return '';
}

/** Union of all row keys in first-seen order. */
export function collectColumnNames(rows: readonly GridRow[]): string[] {
  const names = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) names.add(key);
  return [...names];
}

/**
 * Column definitions: every row key in first-seen order.
 * The selection checkbox column comes from the grid's `rowSelection`, not from here.
 * No rows gives no columns.
 */
export function buildColumnDefs(rows: readonly GridRow[]): ColDef[] {
  if (rows.length === 0) return [];
  return collectColumnNames(rows).map((name) => ({ field: name, headerName: name }));
}
