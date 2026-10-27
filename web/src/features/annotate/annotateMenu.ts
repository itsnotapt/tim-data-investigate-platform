import type { CellKeyDownEvent, GridApi } from 'ag-grid-community';
import type { ExtraMenuItems, GetExtraContextMenuItems, GridRowWithId } from '../grid';
import { targetIds, targetRows, whyUnlabellable, type LabelledRow } from '../labels';
import type { AnnotateMode } from './annotateLogic';

export interface AnnotateMenuOptions {
  /** The action takes its rows' id from an Id column param. */
  idParam: boolean;
  /** `maxAnnotationIds`: the most distinct `id`s one change takes. */
  max: number;
  /** Opens the dialog for `rows`. */
  open: (mode: AnnotateMode, rows: LabelledRow[]) => void;
  notify: (message: string) => void;
}

/**
 * Annotate… (T) and Comment… (C) for the selected rows. With targets that can't be annotated, the
 * items are disabled with the reason as their tooltip.
 */
export function buildAnnotateMenu({
  idParam,
  max,
  open,
}: AnnotateMenuOptions): GetExtraContextMenuItems {
  return (params) => {
    const rows = targetRows(params.api as GridApi<GridRowWithId>, params.node);
    if (rows.length === 0) return [];
    const reason = whyUnlabellable(targetIds(rows), max, idParam);
    const state = { disabled: reason !== null, tooltip: reason ?? undefined };
    return [
      { name: 'Annotate…', shortcut: 'T', ...state, action: () => open('annotate', rows) },
      { name: 'Comment…', shortcut: 'C', ...state, action: () => open('comment', rows) },
    ] satisfies ExtraMenuItems;
  };
}

/** Row detail (D) for the right-clicked row, with or without an id. */
export function buildRowDetailMenu(open: (row: LabelledRow) => void): GetExtraContextMenuItems {
  return (params) => {
    const row = params.node?.data as LabelledRow | undefined;
    if (!row) return [];
    return [
      { name: 'Row detail', shortcut: 'D', action: () => open(row) },
    ] satisfies ExtraMenuItems;
  };
}

/** The key event when it is a plain key press with no cell being edited, else null. */
function plainKey(e: CellKeyDownEvent<GridRowWithId>): KeyboardEvent | null {
  const key = e.event as KeyboardEvent | null | undefined;
  if (!key || key.ctrlKey || key.metaKey || key.altKey) return null;
  return e.api.getEditingCells().length > 0 ? null : key;
}

const KEYS: Record<string, AnnotateMode> = { t: 'annotate', c: 'comment' };

/**
 * T opens Annotate…, C opens Comment…, for the selected rows or the focused row. When the rows
 * can't be annotated, the reason shows in a toast.
 */
export function makeAnnotateKeys({ idParam, max, open, notify }: AnnotateMenuOptions) {
  return (e: CellKeyDownEvent<GridRowWithId>) => {
    const key = plainKey(e);
    const mode = key && KEYS[key.key.toLowerCase()];
    if (!key || !mode) return;
    const rows = targetRows(e.api, e.node);
    if (rows.length === 0) return;
    key.preventDefault();
    const reason = whyUnlabellable(targetIds(rows), max, idParam);
    if (reason !== null) return notify(reason);
    open(mode, rows);
  };
}

/** D opens Row detail on the focused row, or closes it when it's open. */
export function makeRowDetailKeys(toggle: (row: LabelledRow) => void) {
  return (e: CellKeyDownEvent<GridRowWithId>) => {
    const key = plainKey(e);
    if (!key || key.key.toLowerCase() !== 'd') return;
    const row = e.node.data;
    if (!row) return;
    key.preventDefault();
    toggle(row);
  };
}
