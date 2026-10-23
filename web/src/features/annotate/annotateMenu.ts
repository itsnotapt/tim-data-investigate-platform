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
    const items: ExtraMenuItems = [
      { name: 'Annotate…', shortcut: 'T', ...state, action: () => open('annotate', rows) },
      { name: 'Comment…', shortcut: 'C', ...state, action: () => open('comment', rows) },
    ];
    return items;
  };
}

export interface HistoryMenuOptions {
  /** The action takes its rows' id from an Id column param. */
  idParam: boolean;
  /** Opens the History panel on `row`. */
  open: (row: LabelledRow) => void;
  notify: (message: string) => void;
}

/** History (H) for the right-clicked row; disabled, with the reason, for a row without an id. */
export function buildHistoryMenu({ idParam, open }: HistoryMenuOptions): GetExtraContextMenuItems {
  return (params) => {
    const row = params.node?.data as LabelledRow | undefined;
    if (!row) return [];
    const reason = whyUnlabellable(targetIds([row]), 1, idParam);
    const items: ExtraMenuItems = [
      {
        name: 'History',
        shortcut: 'H',
        disabled: reason !== null,
        tooltip: reason ?? undefined,
        action: () => open(row),
      },
    ];
    return items;
  };
}

/** H opens the History panel on the focused row. A row without an id gives the reason in a toast. */
export function makeHistoryKeys({ idParam, open, notify }: HistoryMenuOptions) {
  return (e: CellKeyDownEvent<GridRowWithId>) => {
    const key = e.event as KeyboardEvent | null | undefined;
    if (!key || key.ctrlKey || key.metaKey || key.altKey || key.key.toLowerCase() !== 'h') return;
    const row = e.node.data;
    if (!row || e.api.getEditingCells().length > 0) return;
    key.preventDefault();
    const reason = whyUnlabellable(targetIds([row]), 1, idParam);
    if (reason !== null) return notify(reason);
    open(row);
  };
}

const KEYS: Record<string, AnnotateMode> = { t: 'annotate', c: 'comment' };

/**
 * T opens Annotate…, C opens Comment…, for the selected rows or the focused row. When the rows
 * can't be annotated, the reason shows in a toast.
 */
export function makeAnnotateKeys({ idParam, max, open, notify }: AnnotateMenuOptions) {
  return (e: CellKeyDownEvent<GridRowWithId>) => {
    const key = e.event as KeyboardEvent | null | undefined;
    if (!key || key.ctrlKey || key.metaKey || key.altKey) return;
    const mode = KEYS[key.key.toLowerCase()];
    if (!mode || e.api.getEditingCells().length > 0) return;
    const rows = targetRows(e.api, e.node);
    if (rows.length === 0) return;
    key.preventDefault();
    const reason = whyUnlabellable(targetIds(rows), max, idParam);
    if (reason !== null) return notify(reason);
    open(mode, rows);
  };
}
