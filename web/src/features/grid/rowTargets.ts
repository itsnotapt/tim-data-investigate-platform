import type { ExtraMenuItems } from './gridOptions';

/** What a grid's context menu or key acts on, by row number. */
export interface RowTargets {
  /** The selected rows, else the clicked or focused row. */
  rows: readonly number[];
  /** The clicked or focused row; `null` on a group row or outside the rows. */
  row: number | null;
  /** The clicked or focused column's id. */
  column: string | null;
}

/** Items for a grid's context menu, on its targets. */
export type RowsMenu = (targets: RowTargets) => ExtraMenuItems;

/** Handles a key pressed in a grid's cell, on its targets, while no cell is being edited. */
export type RowsKeys = (key: KeyboardEvent, targets: RowTargets) => void;
