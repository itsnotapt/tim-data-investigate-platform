import type { ColDef, RowClassRules } from 'ag-grid-community';
import { LABEL_COLOURS } from '../../app/theme';
import type { Annotations, InstanceLabel, RunRow } from '../../lib/api';
import { gridRowId, type GridRowWithId } from '../grid';
import { shownLabel } from './labels';

/** An action grid's row: the run's row, its grid row id, its `id` and the `id`'s annotations. */
export type LabelledRow = GridRowWithId & { id?: string | null; annotations?: Annotations };

/** The rows of a tab's Results with these row numbers, as they are now. */
export type RowsOf = (rowNumbers: readonly number[]) => (RunRow & LabelledRow)[];

/** The longest `id` an annotation can have. */
export const MAX_ID_LENGTH = 512;

/**
 * A row's `id`: the value of its Id column, a string as is and anything else as JSON. No Id
 * column, a missing, `null` or empty value, or one longer than {@link MAX_ID_LENGTH}, is no id.
 */
export function rowId(
  data: Readonly<Record<string, unknown>>,
  idColumn: string | null,
): string | null {
  if (idColumn === null) return null;
  const value = data[idColumn];
  if (value === undefined || value === null) return null;
  const id = typeof value === 'string' ? value : JSON.stringify(value);
  return id === '' || id.length > MAX_ID_LENGTH ? null : id;
}

/** `rows` with the `id` of their Id column, and no annotations yet. */
export function withIds(
  rows: readonly RunRow[],
  idColumn: string | null,
): (RunRow & LabelledRow)[] {
  return rows.map((r) => ({ row: r.row, data: r.data, id: rowId(r.data, idColumn) }));
}

/** The label key of a grid row's annotations, else `null`. */
export function rowLabelKey(data: unknown): string | null {
  return (data as LabelledRow | null | undefined)?.annotations?.label?.key ?? null;
}

/**
 * Row class rules of a labelled row: `tim-label` and its colour. Rules, unlike `getRowClass`, take
 * a class off again when the label changes.
 */
export function labelClassRules(labels: readonly InstanceLabel[]): RowClassRules<GridRowWithId> {
  const colour = (data: unknown) => {
    const key = rowLabelKey(data);
    return key === null ? null : shownLabel(key, labels).colour;
  };
  return {
    'tim-label': (p) => rowLabelKey(p.data) !== null,
    ...Object.fromEntries(
      LABEL_COLOURS.map((c) => [`tim-label-${c}`, (p: { data?: unknown }) => colour(p.data) === c]),
    ),
  };
}

/** The hidden Label column. */
export const LABEL_COLUMN_ID = 'tim:label';

/** The hidden Label column: the label's name, filterable with a set filter and groupable. */
export function labelColumnDef(labels: readonly InstanceLabel[]): ColDef {
  return {
    colId: LABEL_COLUMN_ID,
    headerName: 'Label',
    initialHide: true,
    filter: 'agSetColumnFilter',
    enableRowGroup: true,
    valueGetter: (p) => {
      const key = rowLabelKey(p.data);
      return key === null ? null : shownLabel(key, labels).name;
    },
  };
}

/** The grid row ids of each `id`, so a change to an `id` updates every row that has it. */
export type RowsById = Map<string, string[]>;

/** Adds `rows` to `index`. */
export function indexRows(index: RowsById, rows: readonly LabelledRow[]): void {
  for (const row of rows) {
    if (!row.id) continue;
    const ids = index.get(row.id);
    if (ids) ids.push(gridRowId(row));
    else index.set(row.id, [gridRowId(row)]);
  }
}
