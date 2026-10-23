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
