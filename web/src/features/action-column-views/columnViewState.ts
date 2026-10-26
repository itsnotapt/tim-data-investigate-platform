import type { GridState, GridStateKey } from 'ag-grid-community';
import { stringifyJson } from '../../lib/json';

/**
 * A column view's state: the column and filter sections of AG Grid's `GridState`, with
 * `partialColumnState: true` (ADR-0022).
 */
export type ColumnViewState = Pick<
  GridState,
  keyof typeof EMPTY | 'version' | 'partialColumnState'
>;

/** The sections a column view keeps, each with its empty value. */
const EMPTY = {
  columnOrder: { orderedColIds: [] },
  columnSizing: { columnSizingModel: [] },
  columnVisibility: { hiddenColIds: [] },
  columnPinning: { leftColIds: [], rightColIds: [] },
  columnHeaderName: { columnHeaderNames: [] },
  userColumns: [],
  sort: { sortModel: [] },
  rowGroup: { groupColIds: [] },
  aggregation: { aggregationModel: [] },
  pivot: { pivotMode: false, pivotColIds: [] },
  filter: { filterModel: {} },
} as const satisfies Partial<GridState>;

const VIEW_KEYS = Object.keys(EMPTY) as (keyof typeof EMPTY)[];

/** Every `GridState` section, so `setState` can be told which to leave alone. */
const ALL_KEYS: Record<GridStateKey, true> = {
  aggregation: true,
  cellSelection: true,
  columnGroup: true,
  columnHeaderName: true,
  columnOrder: true,
  columnPinning: true,
  columnSizing: true,
  columnVisibility: true,
  filter: true,
  find: true,
  focusedCell: true,
  pagination: true,
  pivot: true,
  quickFilter: true,
  rowGroup: true,
  rowGroupExpansion: true,
  rowPinning: true,
  rowSelection: true,
  scroll: true,
  showValuesAs: true,
  sideBar: true,
  sort: true,
  ssrmRowGroupExpansion: true,
  userColumns: true,
};

/** AG Grid's own column ids, such as the selection and group columns. */
export const isGridColumn = (colId: string) => colId.startsWith('ag-Grid-');

/**
 * The column view sections of the grid's state, without AG Grid's own header names. The grid
 * leaves a section out when it's empty; here it's given its empty value, so applying the column
 * view clears it.
 */
export function columnViewStateOf(state: GridState): ColumnViewState {
  const view: ColumnViewState = { partialColumnState: true };
  if (state.version !== undefined) view.version = state.version;
  for (const key of VIEW_KEYS) {
    Object.assign(view, { [key]: structuredClone(state[key] ?? EMPTY[key]) });
  }
  if (view.columnHeaderName) {
    view.columnHeaderName = {
      columnHeaderNames: view.columnHeaderName.columnHeaderNames.filter(
        (h) => !isGridColumn(h.colId),
      ),
    };
  }
  return view;
}

const createdIds = (state: Pick<GridState, 'userColumns'>) =>
  (state.userColumns ?? []).flatMap((c) => (c.created ? [c.colId] : []));

const pick = <T>(record: Record<string, T> | undefined, keep: (colId: string) => boolean) =>
  record && Object.fromEntries(Object.entries(record).filter(([colId]) => keep(colId)));

/**
 * The column view `view` fitted to a result whose action default is `base` (the grid's state just
 * after `resetColumnState()`): columns the result doesn't have are dropped, and the result's
 * columns the column view doesn't know are appended to the order with their action default
 * visibility, pinning and width. The column view's calculated columns are kept; the tab's own are
 * not.
 */
export function fitColumnView(view: ColumnViewState, base: GridState): ColumnViewState {
  const baseCreated = new Set(createdIds(base));
  const columns = [
    ...createdIds(view),
    ...(base.columnOrder?.orderedColIds ?? []).filter((colId) => !baseCreated.has(colId)),
  ];
  const known = new Set(columns);
  const has = (colId: string) => known.has(colId);
  const viewColumns = new Set([
    ...(view.columnOrder?.orderedColIds ?? []),
    ...(view.columnSizing?.columnSizingModel.map((s) => s.colId) ?? []),
    ...(view.columnVisibility?.hiddenColIds ?? []),
    ...(view.columnPinning?.leftColIds ?? []),
    ...(view.columnPinning?.rightColIds ?? []),
  ]);
  const missing = columns.filter((colId) => !viewColumns.has(colId));
  const isMissing = (colId: string) => missing.includes(colId);

  const fitted: ColumnViewState = { ...structuredClone(view) };
  if (view.columnOrder) {
    fitted.columnOrder = {
      orderedColIds: [...view.columnOrder.orderedColIds.filter(has), ...missing],
    };
  }
  if (view.columnVisibility) {
    fitted.columnVisibility = {
      hiddenColIds: [
        ...view.columnVisibility.hiddenColIds.filter(has),
        ...(base.columnVisibility?.hiddenColIds ?? []).filter(isMissing),
      ],
    };
  }
  if (view.columnPinning) {
    fitted.columnPinning = {
      leftColIds: [
        ...view.columnPinning.leftColIds.filter(has),
        ...(base.columnPinning?.leftColIds ?? []).filter(isMissing),
      ],
      rightColIds: [
        ...view.columnPinning.rightColIds.filter(has),
        ...(base.columnPinning?.rightColIds ?? []).filter(isMissing),
      ],
    };
  }
  if (view.columnSizing) {
    fitted.columnSizing = {
      columnSizingModel: [
        ...view.columnSizing.columnSizingModel.filter((s) => has(s.colId)),
        ...(base.columnSizing?.columnSizingModel ?? []).filter((s) => isMissing(s.colId)),
      ],
    };
  }
  if (view.columnHeaderName) {
    fitted.columnHeaderName = {
      columnHeaderNames: view.columnHeaderName.columnHeaderNames.filter((h) => has(h.colId)),
    };
  }
  if (view.sort) {
    fitted.sort = { sortModel: view.sort.sortModel.filter((s) => has(s.colId)) };
  }
  if (view.rowGroup) fitted.rowGroup = { groupColIds: view.rowGroup.groupColIds.filter(has) };
  if (view.aggregation) {
    fitted.aggregation = {
      aggregationModel: view.aggregation.aggregationModel.filter((a) => has(a.colId)),
    };
  }
  if (view.pivot) {
    fitted.pivot = {
      ...structuredClone(view.pivot),
      pivotColIds: view.pivot.pivotColIds.filter(has),
      ...(view.pivot.pivotSortModel && {
        pivotSortModel: view.pivot.pivotSortModel.filter((s) => has(s.colId)),
      }),
    };
  }
  if (view.filter) {
    const filter = structuredClone(view.filter);
    if (filter.filterModel) filter.filterModel = pick(filter.filterModel, has);
    if (filter.columnFilterState) filter.columnFilterState = pick(filter.columnFilterState, has);
    fitted.filter = filter;
  }
  return fitted;
}

/**
 * Whether the tab's `current` column view state differs from the `baseline` it started with.
 * Columns the baseline didn't know count as they are now, so a wider result isn't a change.
 */
export function isModified(baseline: ColumnViewState, current: ColumnViewState): boolean {
  return !sameColumnView(fitColumnView(baseline, current), current);
}

/** The sections `setState` leaves alone when it applies `view`: each one `view` leaves out. */
export function ignoredKeys(view: ColumnViewState): GridStateKey[] {
  return (Object.keys(ALL_KEYS) as GridStateKey[]).filter((key) => !(key in view));
}

/** JSON with object keys sorted, so key order doesn't count. */
function canonical(value: unknown): string {
  return stringifyJson(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Whether two column view states set the same columns and filters, whatever AG Grid version. */
export function sameColumnView(a: ColumnViewState, b: ColumnViewState): boolean {
  return canonical({ ...a, version: undefined }) === canonical({ ...b, version: undefined });
}
