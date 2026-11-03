import type { MenuItemDef } from 'ag-grid-community';
import type { InstanceLabel } from '../../lib/api';
import type { ExtraMenuItems, RowsKeys, RowsMenu } from '../grid';
import { whyUnlabellable, setLabel, targetIds, type LabellingDeps } from './labelling';
import { rowLabelKey, type RowsOf } from './labelRows';

export interface LabelMenuOptions extends LabellingDeps {
  /** `maxAnnotationIds`: the most distinct `id`s one change takes. */
  max: number;
  /** The rows of the targets, as the tab's Results have them now. */
  rowsOf: RowsOf;
}

/** Sets the label of the `id`s the rows have now, or says why they can't be labelled. */
function labelNow(rowNumbers: readonly number[], key: string | null, options: LabelMenuOptions) {
  const targets = targetIds(options.rowsOf(rowNumbers));
  const reason = whyUnlabellable(targets, options.max);
  if (reason !== null) return options.notify(reason);
  void setLabel(targets, key, options);
}

/** A label's colour swatch, as a menu icon. */
const swatch = (label: InstanceLabel) =>
  `<span class="tim-label-swatch tim-label-${label.colour}"></span>`;

/**
 * The Label ▸ submenu: the labels in file order with swatch and key (1–9), each checked when every
 * target has it, then Clear label (0). With targets that can't be labelled, the items are disabled
 * with the reason as their tooltip. An item labels the `id`s the targets have when it is picked.
 */
export function buildLabelMenu(options: LabelMenuOptions): RowsMenu {
  const { labels, max, rowsOf } = options;
  return (targets) => {
    const rows = rowsOf(targets.rows);
    if (rows.length === 0) return [];
    const reason = whyUnlabellable(targetIds(rows), max);
    const withId = rows.filter((r) => r.id);
    const state = { disabled: reason !== null, tooltip: reason ?? undefined };
    const items: ExtraMenuItems = labels.map((label, i): MenuItemDef => ({
      name: label.name,
      icon: swatch(label),
      shortcut: i < 9 ? String(i + 1) : undefined,
      checked: reason === null && withId.every((r) => rowLabelKey(r) === label.key),
      ...state,
      action: () => labelNow(targets.rows, label.key, options),
    }));
    const clear: MenuItemDef = {
      name: 'Clear label',
      shortcut: '0',
      ...state,
      action: () => labelNow(targets.rows, null, options),
    };
    return [{ name: 'Label', subMenu: [...items, 'separator', clear] }];
  };
}

const DIGIT = /^[0-9]$/;

/**
 * Number keys: 1–9 set the label of that place, 0 clears it, on the selected rows or the focused
 * row. When the rows can't be labelled, the reason shows in a toast.
 */
export function makeLabelKeys(options: LabelMenuOptions): RowsKeys {
  const { labels, rowsOf } = options;
  return (key, targets) => {
    if (!DIGIT.test(key.key) || key.ctrlKey || key.metaKey || key.altKey) return;
    const n = Number(key.key);
    const label = n === 0 ? null : labels[n - 1];
    if (label === undefined) return;
    if (rowsOf(targets.rows).length === 0) return;
    key.preventDefault();
    labelNow(targets.rows, label?.key ?? null, options);
  };
}
