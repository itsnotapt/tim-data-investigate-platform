import type { ColDef, GridState, UserColumnState } from 'ag-grid-community';
import { dump } from 'js-yaml';
import type { CatalogueColumn, RunColumn } from '../../lib/api';
import { isGridColumn } from './columnViewState';

/** AG Grid's width of a column that sets none. */
const DEFAULT_WIDTH = 200;

/** The type of each of TIM's own columns. */
const TIM_COLUMN_TYPES: Record<string, ActionFileColumn['type']> = {
  'tim:label': 'string',
  'tim:tags': 'json',
  'tim:commentText': 'string',
  'tim:comments': 'string',
};

/** An action file column type for each type of AG Grid's calculated column dialog. */
const CALCULATED_TYPES: Record<string, ActionFileColumn['type']> = {
  number: 'number',
  boolean: 'boolean',
  date: 'datetime',
  dateString: 'datetime',
  dateTime: 'datetime',
  dateTimeString: 'datetime',
  object: 'json',
};

/** The column definition properties the analyst set on a column in the grid. */
function userProperties(column: UserColumnState): ColDef {
  return Object.fromEntries((column.properties ?? []).map((p) => [p.property, p.value]));
}

/** One entry of an action file's `columns:`, its keys in the action file's order. */
interface ActionFileColumn {
  name: string;
  type: CatalogueColumn['type'];
  title?: string;
  hidden?: true;
  width?: number;
  pinned?: 'left' | 'right';
  sort?: 'asc' | 'desc';
  group?: true;
  calculated?: string;
}

/** The `columns:` block of an action tab's grid state. */
export type ActionFileOf = (state: GridState) => string;

export interface ActionFileColumnsInput {
  /** The tab's grid state. */
  state: GridState;
  /** The action's declared columns. */
  declared: readonly CatalogueColumn[] | null | undefined;
  /** The run's columns. */
  runColumns: readonly RunColumn[] | null | undefined;
  /** TIM's own columns, as the grid gets them. */
  own: readonly ColDef[];
}

/**
 * An action file's `columns:` block that gives an action's grid the tab's column layout: each
 * column in grid order, with its type and the settings that aren't the grid's defaults. TIM's own
 * columns are in it only when they aren't as TIM sets them, or come before a result column.
 * Filters are left out.
 */
export function actionFileColumns({
  state,
  declared,
  runColumns,
  own,
}: ActionFileColumnsInput): string {
  const declaredByName = new Map(declared?.map((c) => [c.name, c]));
  const ownById = new Map(own.map((c) => [c.colId, c]));
  const userColumns = new Map(state.userColumns?.map((c) => [c.colId, userProperties(c)]));
  const created = (state.userColumns ?? []).filter((c) => c.created);
  const types = new Map([
    ...(declared ?? []).map((c) => [c.name, c.type] as const),
    ...(runColumns ?? []).map((c) => [c.name, c.type] as const),
    ...created.map((c) => {
      const dataType = userColumns.get(c.colId)?.cellDataType;
      return [
        c.colId,
        (typeof dataType === 'string' && CALCULATED_TYPES[dataType]) || 'string',
      ] as const;
    }),
    ...Object.entries(TIM_COLUMN_TYPES).filter(([colId]) => ownById.has(colId)),
  ]);
  const headers = new Map(
    state.columnHeaderName?.columnHeaderNames.map((h) => [h.colId, h.headerName]),
  );
  const widths = new Map(state.columnSizing?.columnSizingModel.map((s) => [s.colId, s.width]));
  const hidden = new Set(state.columnVisibility?.hiddenColIds);
  const left = new Set(state.columnPinning?.leftColIds);
  const right = new Set(state.columnPinning?.rightColIds);
  const sorts = new Map(state.sort?.sortModel.map((s) => [s.colId, s.sort]));
  const groups = new Set(state.rowGroup?.groupColIds);
  const order = (state.columnOrder?.orderedColIds ?? []).filter(
    (colId) => !isGridColumn(colId) && types.has(colId),
  );
  const lastResult = order.findLastIndex((colId) => !ownById.has(colId));
  return dump({
    columns: order.flatMap((name, index): ActionFileColumn[] => {
      const owned = ownById.get(name);
      const column = declaredByName.get(name);
      const user = userColumns.get(name);
      const defaultTitle = owned?.headerName ?? name;
      const defaultWidth = owned?.width ?? DEFAULT_WIDTH;
      const title = headers.get(name) ?? user?.headerName ?? column?.title ?? defaultTitle;
      const calculated = user?.calculatedExpression ?? column?.calculated ?? undefined;
      const width = widths.get(name) ?? defaultWidth;
      const sort = sorts.get(name);
      const entry: ActionFileColumn = {
        name,
        type: types.get(name)!,
        ...(title !== defaultTitle && { title }),
        ...(hidden.has(name) && { hidden: true }),
        ...(width !== defaultWidth && { width }),
        ...(left.has(name) && { pinned: 'left' }),
        ...(right.has(name) && { pinned: 'right' }),
        ...(sort && { sort }),
        ...(groups.has(name) && { group: true }),
        ...(calculated && { calculated }),
      };
      const asTimSets =
        index > lastResult &&
        hidden.has(name) === Boolean(owned?.initialHide ?? owned?.hide) &&
        Object.keys(entry).every((key) => key === 'name' || key === 'type' || key === 'hidden');
      return owned && asTimSets ? [] : [entry];
    }),
  });
}
