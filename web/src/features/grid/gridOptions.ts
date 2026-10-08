import type {
  ColDef,
  GetContextMenuItems,
  GetContextMenuItemsParams,
  GridOptions,
  DefaultMenuItem,
  MenuItemDef,
  SideBarDef,
  StatusPanelDef,
} from 'ag-grid-community';
import { ExecutionStatusPanel } from './ExecutionStatusPanel';
import { aggFuncs } from './aggregation';
import { ROW_ID_FIELD, scalarText } from './columns';
import type { GridRowWithId } from './columns';
import { rowClassRules } from './rowClasses';

/** Side bar (screens 17, 18): Columns and Filters tool panels. */
const SIDE_BAR: SideBarDef['toolPanels'] & string[] = ['columns', 'filters'];

/** Screen 15: execution stats on the left, then total / filtered / selected counts. */
const STATUS_PANELS: StatusPanelDef[] = [
  { statusPanel: ExecutionStatusPanel, align: 'left' },
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
  // No type inference: object cells (TagEvent, arrays) would warn about a missing valueFormatter.
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
  cellEditorPopup: true,
  cellEditorPopupPosition: 'under',
  cellEditor: 'agLargeTextCellEditor',
  cellEditorParams: { maxLength: 300, cols: 100, rows: 6 },
  getQuickFilterText: (params) => quickFilterText(params.value),
};

export type ExtraMenuItems = (DefaultMenuItem | MenuItemDef)[];
/** Extension point for pivots, tagging and details. */
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

export function makeGetContextMenuItems(extra?: GetExtraContextMenuItems): GetContextMenuItems {
  return (params) => buildContextMenu(extra?.(params));
}

/** Options that do not depend on props. */
export const staticGridOptions: GridOptions<GridRowWithId> = {
  aggFuncs,
  animateRows: false,
  cacheQuickFilter: true,
  defaultColDef,
  getRowId: (p) => p.data[ROW_ID_FIELD],
  groupDisplayType: 'groupRows',
  groupRowRendererParams: { checkbox: true },
  maintainColumnOrder: true,
  readOnlyEdit: true,
  rowBuffer: 20,
  rowClassRules,
  rowSelection: {
    mode: 'multiRow',
    groupSelects: 'filteredDescendants',
    enableClickSelection: false,
    headerCheckbox: true,
    selectAll: 'filtered',
  },
  // Checkboxes stay visible while the grid scrolls sideways.
  selectionColumnDef: {
    pinned: 'left',
    lockPinned: true,
    lockPosition: true,
    suppressMovable: true,
    width: 42,
    resizable: false,
    sortable: false,
  },
  cellSelection: true,
  sideBar: SIDE_BAR,
  statusBar: { statusPanels: STATUS_PANELS },
  skipHeaderOnAutoSize: true,
  suppressColumnMoveAnimation: false,
};
