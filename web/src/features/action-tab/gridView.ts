import type { Column, GridApi, GridState, IRowNode } from 'ag-grid-community';
import type { RowTargets } from '../grid';
import type { GridRowWithId } from '../grid/columns';
import { SELECTION_COLUMN_ID } from '../grid/gridOptions';
import type { Results, ResultsChange } from './results';

/** The prefix of the ids AG Grid gives its own columns, such as the selection column. */
const GRID_COLUMN_PREFIX = 'ag-Grid-';

/** The row number of `node`'s row; `null` for a group row or no node. */
function rowOf(node: IRowNode | null | undefined): number | null {
  if (!node || node.group) return null;
  return (node.data as GridRowWithId | undefined)?.row ?? null;
}

/**
 * An action tab's grid, as the rest of the app sees it: which rows the analyst has selected,
 * clicked, focused or filtered, by row number, and moving between them. The row data and `id`s
 * of those rows come from the tab's Results.
 */
export interface GridView {
  /** Whether the grid has gone. */
  isDestroyed(): boolean;
  /** Applies a change to the tab's Results to the grid's copy of the rows. */
  apply(change: ResultsChange, results: Results): void;
  /** The targets of a context menu opened, or a key pressed, in `node`'s row and `column`. */
  targets(node: IRowNode | null | undefined, column: Column | null | undefined): RowTargets;
  /** The row number of the row shown at `index`; `null` for a group row. */
  displayedRow(index: number): number | null;
  /** Whether a cell is being edited. */
  isEditing(): boolean;
  /** How many rows the grid has, filtered or not. */
  rowCount(): number;
  /** Those of `rows` that the filters let through, in the order the grid shows them. */
  shownAmong(rows: ReadonlySet<number>): number[];
  /**
   * Opens the groups `row` is in, scrolls it to the middle and focuses its first data cell.
   * `false` when the grid hasn't the row.
   */
  goTo(row: number): boolean;
  /** Flashes `row`'s cells. */
  flash(row: number): void;
  /** Whether `row`, or the closed group it is in, is above the viewport. */
  isAbove(row: number): boolean;
  /** Calls `listener` when the rows shown change: rows, filters, sort or groups. Returns the unsubscribe. */
  onShownChange(listener: () => void): () => void;
  /** Calls `listener` when the grid scrolls. Returns the unsubscribe. */
  onScroll(listener: () => void): () => void;
  /** The grid's state, for its column settings. */
  state(): GridState;
}

/** The view of the grid behind `api`. */
export function gridView(api: GridApi): GridView {
  const node = (row: number) => api.getRowNode(String(row));
  const listen = (type: 'modelUpdated' | 'bodyScroll', listener: () => void) => {
    api.addEventListener(type, listener);
    return () => {
      if (!api.isDestroyed()) api.removeEventListener(type, listener);
    };
  };
  return {
    isDestroyed: () => api.isDestroyed(),
    apply: (change, results) => applyChange(api, change, results),
    targets: (target, column) => {
      const row = rowOf(target);
      const selected = api.getSelectedNodes().flatMap((n) => {
        const r = rowOf(n);
        return r === null ? [] : [r];
      });
      return {
        rows: selected.length > 0 ? selected : row === null ? [] : [row],
        row,
        column: column?.getColId() ?? null,
      };
    },
    displayedRow: (index) => rowOf(api.getDisplayedRowAtIndex(index)),
    isEditing: () => api.getEditingCells().length > 0,
    rowCount: () => {
      let count = 0;
      api.forEachLeafNode(() => count++);
      return count;
    },
    shownAmong: (rows) => {
      const shown: number[] = [];
      api.forEachNodeAfterFilterAndSort((n) => {
        const r = rowOf(n);
        if (r !== null && rows.has(r)) shown.push(r);
      });
      return shown;
    },
    goTo: (row) => {
      const target = node(row);
      if (!target?.data) return false;
      for (let group = target.parent; group && group.level >= 0; group = group.parent) {
        group.setExpanded(true, undefined, true);
      }
      api.ensureNodeVisible(target, 'middle');
      const column = api
        .getAllDisplayedColumns()
        .find((c) => !c.getColId().startsWith(GRID_COLUMN_PREFIX));
      if (target.rowIndex !== null && column) api.setFocusedCell(target.rowIndex, column);
      return true;
    },
    flash: (row) => {
      const target = node(row);
      if (target) api.flashCells({ rowNodes: [target] });
    },
    isAbove: (row) => {
      let shown: IRowNode | null | undefined = node(row);
      while (shown && (shown.rowTop === null || !shown.displayed)) shown = shown.parent;
      if (!shown || shown.rowTop === null) return false;
      return shown.rowTop + (shown.rowHeight ?? 0) <= api.getVerticalPixelRange().top;
    },
    onShownChange: (listener) => listen('modelUpdated', listener),
    onScroll: (listener) => listen('bodyScroll', listener),
    state: () => api.getState(),
  };
}

/** Applies a change to the tab's Results to the grid. */
function applyChange(grid: GridApi, change: ResultsChange, results: Results): void {
  switch (change.type) {
    case 'added':
      grid.applyTransaction({ add: [...change.rows] });
      return;
    case 'replaced':
      // The grid matches the rows by row id, so it updates those it has in place.
      grid.setGridOption('rowData', [...results.rows]);
      return;
    case 'annotated': {
      const nodes = grid.applyTransaction({ update: [...change.rows] })?.update ?? [];
      // The symbol has no value of its own, so its cells are redrawn.
      grid.refreshCells({ rowNodes: nodes, columns: [SELECTION_COLUMN_ID], force: true });
      if (change.source === 'feed' && nodes.length > 0) grid.flashCells({ rowNodes: nodes });
      return;
    }
    case 'loaded':
      return;
  }
}
