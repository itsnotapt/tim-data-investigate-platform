import type {
  ColDef,
  GetContextMenuItems,
  GetContextMenuItemsParams,
  GridOptions,
  DefaultMenuItem,
  MenuItemDef,
  SelectionColumnDef,
  SideBarDef,
  StatusPanelDef,
} from 'ag-grid-community';
import type { CustomCellRendererProps } from 'ag-grid-react';
import type { ComponentType } from 'react';
import { aggFuncs } from './aggregation';
import { gridRowId, scalarText } from './columns';
import type { GridRowWithId } from './columns';

/** Side bar (screens 17, 18): Columns and Filters tool panels. */
export const SIDE_BAR: SideBarDef['toolPanels'] & string[] = ['columns', 'filters'];

/** Total, filtered and selected counts. */
export const STATUS_PANELS: StatusPanelDef[] = [
  { statusPanel: 'agTotalRowCountComponent' },
  { statusPanel: 'agFilteredRowCountComponent' },
  { statusPanel: 'agSelectedRowCountComponent' },
];

/** Case-insensitive-by-grid quick filter text; objects are searched as JSON. */
export function quickFilterText(value: unknown): string {
  return scalarText(value);
}

/** Date comparator of the multi filter: null cells sort before any filter date. */
export function dateComparator(filterDate: Date, cellValue: unknown): number {
  if (cellValue === null || cellValue === undefined) return -1;
  return Date.parse(scalarText(cellValue)) - filterDate.getTime();
}

/** Multi filter: text, number, date (sub-menus) and set filter. */
export const defaultColDef: ColDef = {
  // No type inference: object and array cells would warn about a missing valueFormatter.
  cellDataType: false,
  enableValue: true,
  editable: false,
  filter: 'agMultiColumnFilter',
  filterParams: {
    filters: [
      { filter: 'agTextColumnFilter', display: 'subMenu' },
      { filter: 'agNumberColumnFilter', display: 'subMenu' },
      {
        filter: 'agDateColumnFilter',
        display: 'subMenu',
        filterParams: { comparator: dateComparator },
      },
      { filter: 'agSetColumnFilter' },
    ],
  },
  enableRowGroup: true,
  sortable: true,
  resizable: true,
  getQuickFilterText: (params) => quickFilterText(params.value),
};

export type ExtraMenuItems = (DefaultMenuItem | MenuItemDef)[];
/** Extension point for pivots and details. */
export type GetExtraContextMenuItems = (params: GetContextMenuItemsParams) => ExtraMenuItems;

/** Extra items first, a separator, then copy / copy with headers / export. */
export function buildContextMenu(extra: ExtraMenuItems = []): ExtraMenuItems {
  return [
    ...extra,
    ...(extra.length > 0 ? (['separator'] as const) : []),
    'copy',
    'copyWithHeaders',
    'export',
  ];
}

/**
 * The grid's context menu. Its targets are the selected rows, so opening it on a row that isn't
 * selected selects just that row first.
 */
export function makeGetContextMenuItems(extra?: GetExtraContextMenuItems): GetContextMenuItems {
  return (params) => {
    if (params.node?.data && !params.node.isSelected()) params.node.setSelected(true, true);
    return buildContextMenu(extra?.(params) ?? []);
  };
}

/** Column id AG Grid gives the selection checkbox column. */
export const SELECTION_COLUMN_ID = 'ag-Grid-SelectionColumn';

/**
 * Selection column, pinned left: the checkbox, and the row's `symbol` when there is one. The width
 * is the 7px cell padding each side, the 16px checkbox, and the 6px gap and widest symbol.
 */
export function buildSelectionColumnDef(
  symbol?: ComponentType<CustomCellRendererProps>,
): SelectionColumnDef {
  const width = symbol ? 55 : 30;
  return {
    cellRenderer: symbol,
    pinned: 'left',
    lockPinned: true,
    lockPosition: true,
    suppressMovable: true,
    width,
    minWidth: width,
    resizable: false,
    sortable: false,
  };
}

/** Options that do not depend on props. */
export const staticGridOptions: GridOptions<GridRowWithId> = {
  aggFuncs,
  animateRows: false,
  cacheQuickFilter: true,
  // Evaluates `calculatedExpression` columns (an action's declared `calculated` columns), and lets
  // the analyst add their own from the column menu.
  calculatedColumns: true,
  defaultColDef,
  getRowId: (p) => gridRowId(p.data),
  groupDisplayType: 'groupRows',
  groupRowRendererParams: { checkbox: true },
  maintainColumnOrder: true,
  rowBuffer: 20,
  rowSelection: {
    mode: 'multiRow',
    groupSelects: 'filteredDescendants',
    enableClickSelection: false,
    headerCheckbox: true,
    selectAll: 'filtered',
  },
  cellSelection: true,
  sideBar: SIDE_BAR,
  statusBar: { statusPanels: STATUS_PANELS },
  skipHeaderOnAutoSize: true,
  suppressColumnMoveAnimation: false,
};
