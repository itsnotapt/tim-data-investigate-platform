import type { ExtraMenuItems, RowsKeys, RowsMenu } from '../grid';
import { targetIds, whyUnlabellable, type RowsOf } from '../labels';
import type { AnnotateMode } from './annotateLogic';

export interface AnnotateMenuOptions {
  /** `maxAnnotationIds`: the most distinct `id`s one change takes. */
  max: number;
  /** The rows of the targets, as the tab's Results have them now. */
  rowsOf: RowsOf;
  /** Opens the dialog for the rows with these row numbers. */
  open: (mode: AnnotateMode, rows: readonly number[]) => void;
  notify: (message: string) => void;
}

/** Whether `key` is pressed with no Ctrl, Meta or Alt. */
const plain = (key: KeyboardEvent) => !key.ctrlKey && !key.metaKey && !key.altKey;

/**
 * Annotate… (T) and Comment… (C) for the selected rows. With targets that can't be annotated, the
 * items are disabled with the reason as their tooltip.
 */
export function buildAnnotateMenu({ max, rowsOf, open }: AnnotateMenuOptions): RowsMenu {
  return (targets) => {
    const rows = rowsOf(targets.rows);
    if (rows.length === 0) return [];
    const reason = whyUnlabellable(targetIds(rows), max);
    const state = { disabled: reason !== null, tooltip: reason ?? undefined };
    return [
      { name: 'Annotate…', shortcut: 'T', ...state, action: () => open('annotate', targets.rows) },
      { name: 'Comment…', shortcut: 'C', ...state, action: () => open('comment', targets.rows) },
    ] satisfies ExtraMenuItems;
  };
}

/** Row detail (D) for the right-clicked row, with or without an id. */
export function buildRowDetailMenu(open: (row: number) => void): RowsMenu {
  return ({ row }) => {
    if (row === null) return [];
    return [
      { name: 'Row detail', shortcut: 'D', action: () => open(row) },
    ] satisfies ExtraMenuItems;
  };
}

const KEYS: Record<string, AnnotateMode> = { t: 'annotate', c: 'comment' };

/**
 * T opens Annotate…, C opens Comment…, for the selected rows or the focused row. When the rows
 * can't be annotated, the reason shows in a toast.
 */
export function makeAnnotateKeys({ max, rowsOf, open, notify }: AnnotateMenuOptions): RowsKeys {
  return (key, targets) => {
    const mode = plain(key) && KEYS[key.key.toLowerCase()];
    if (!mode) return;
    const rows = rowsOf(targets.rows);
    if (rows.length === 0) return;
    key.preventDefault();
    const reason = whyUnlabellable(targetIds(rows), max);
    if (reason !== null) return notify(reason);
    open(mode, targets.rows);
  };
}

/** D opens Row detail on the focused row, or closes it when it's open. */
export function makeRowDetailKeys(toggle: (row: number) => void): RowsKeys {
  return (key, { row }) => {
    if (!plain(key) || key.key.toLowerCase() !== 'd' || row === null) return;
    key.preventDefault();
    toggle(row);
  };
}
