import type { ColDef } from 'ag-grid-community';

/** Row as stored (raw Kusto column name to value). */
export type GridRow = Record<string, unknown>;
/** A grid row plus the client-only `_id` used as the AG Grid row id. */
export type GridRowWithId = GridRow & { _id: string };

export const ROW_ID_FIELD = '_id';
const DEFAULT_ROW_ID_COLUMN = 'EventId';
/** The only editable column. */
export const COMMENT_COLUMN = 'TagEvent.Comment';

/** Editable only for saved rows that have an event id and a determination. */
export function isCommentEditable(data: unknown): boolean {
  const row = data as {
    EventId?: unknown;
    TagEvent?: { IsSaved?: unknown; Determination?: unknown };
  };
  const tag = row?.TagEvent;
  return tag?.IsSaved === true && Boolean(row?.EventId) && Boolean(tag?.Determination);
}

/** Column-specific edit rule. */
function editRule(name: string): Pick<ColDef, 'editable'> {
  return {
    editable: name === COMMENT_COLUMN ? (params) => isCommentEditable(params.data) : false,
  };
}

/** Columns added hidden so the side bar / filters / grouping can reach them. */
const HIDDEN_TAG_COLUMNS = ['TagEvent.Tags', 'TagEvent.Comment', 'TagEvent.Determination'] as const;

/** Text of a cell value: objects as JSON, other values via `String`. */
export function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  return '';
}

/**
 * Adds a unique `_id` to each row: the value of `idColumn` (default `EventId`), or
 * `row-index-<n>` when that is empty/missing/duplicated.
 */
export function prepareRows(rows: readonly GridRow[], idColumn?: string | null): GridRowWithId[] {
  const col = idColumn || DEFAULT_ROW_ID_COLUMN;
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const raw = row[col];
    let id = raw === '' || raw === undefined || raw === null ? '' : scalarText(raw);
    if (id === '' || seen.has(id)) id = `row-index-${index}`;
    seen.add(id);
    return { ...row, [ROW_ID_FIELD]: id };
  });
}

/** Union of all row keys in first-seen order, without `_id`. */
export function collectColumnNames(rows: readonly GridRow[]): string[] {
  const names = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) names.add(key);
  names.delete(ROW_ID_FIELD);
  return [...names];
}

/**
 * Column definitions: every row key in first-seen order, then the hidden TagEvent columns.
 * The selection checkbox column comes from the grid's `rowSelection`, not from here.
 * No rows gives no columns.
 */
export function buildColumnDefs(rows: readonly GridRow[]): ColDef[] {
  if (rows.length === 0) return [];
  const defs: ColDef[] = collectColumnNames(rows).map((name) => ({
    field: name,
    headerName: name,
    ...editRule(name),
  }));
  for (const name of HIDDEN_TAG_COLUMNS) {
    if (defs.some((d) => d.field === name)) continue;
    defs.push({ field: name, headerName: name, hide: true, ...editRule(name) });
  }
  return defs;
}
