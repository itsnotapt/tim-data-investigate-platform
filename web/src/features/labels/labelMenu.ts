import type { CellKeyDownEvent, GridApi, IRowNode, MenuItemDef } from 'ag-grid-community';
import type { InstanceLabel } from '../../lib/api';
import type { ExtraMenuItems, GetExtraContextMenuItems, GridRowWithId } from '../grid';
import { whyUnlabellable, setLabel, targetIds, type LabellingDeps } from './labelling';
import { rowLabelKey, type LabelledRow } from './labelRows';

export interface LabelMenuOptions extends LabellingDeps {
  /** `maxAnnotationIds`: the most distinct `id`s one change takes. */
  max: number;
}

/** The selected rows, or `node`'s row (clicked or focused) when nothing is selected. */
export function targetRows(
  api: GridApi<GridRowWithId>,
  node: IRowNode<GridRowWithId> | null | undefined,
): LabelledRow[] {
  const selected = api.getSelectedNodes().flatMap((n) => (n.data ? [n.data as LabelledRow] : []));
  if (selected.length > 0) return selected;
  return node?.data ? [node.data] : [];
}

/** A label's colour swatch, as a menu icon. */
const swatch = (label: InstanceLabel) =>
  `<span class="tim-label-swatch tim-label-${label.colour}"></span>`;

/**
 * The Label ▸ submenu: the labels in file order with swatch and key (1–9), each checked when every
 * target has it, then Clear label (0). With targets that can't be labelled, the items are disabled
 * with the reason as their tooltip.
 */
export function buildLabelMenu(options: LabelMenuOptions): GetExtraContextMenuItems {
  const { labels, max } = options;
  return (params) => {
    const rows = targetRows(params.api as GridApi<GridRowWithId>, params.node);
    if (rows.length === 0) return [];
    const targets = targetIds(rows);
    const reason = whyUnlabellable(targets, max);
    const withId = rows.filter((r) => r.id);
    const state = { disabled: reason !== null, tooltip: reason ?? undefined };
    const items: ExtraMenuItems = labels.map((label, i): MenuItemDef => ({
      name: label.name,
      icon: swatch(label),
      shortcut: i < 9 ? String(i + 1) : undefined,
      checked: reason === null && withId.every((r) => rowLabelKey(r) === label.key),
      ...state,
      action: () => void setLabel(targets, label.key, options),
    }));
    const clear: MenuItemDef = {
      name: 'Clear label',
      shortcut: '0',
      ...state,
      action: () => void setLabel(targets, null, options),
    };
    return [{ name: 'Label', subMenu: [...items, 'separator', clear] }];
  };
}

const DIGIT = /^[0-9]$/;

/**
 * Number keys: 1–9 set the label of that place, 0 clears it, on the selected rows or the focused
 * row. When the rows can't be labelled, the reason shows in a toast.
 */
export function makeLabelKeys(options: LabelMenuOptions) {
  const { labels, max, notify } = options;
  return (e: CellKeyDownEvent<GridRowWithId>) => {
    const key = e.event as KeyboardEvent | null | undefined;
    if (!key || !DIGIT.test(key.key) || key.ctrlKey || key.metaKey || key.altKey) return;
    if (e.api.getEditingCells().length > 0) return;
    const n = Number(key.key);
    const label = n === 0 ? null : labels[n - 1];
    if (label === undefined) return;
    const rows = targetRows(e.api, e.node);
    if (rows.length === 0) return;
    key.preventDefault();
    const targets = targetIds(rows);
    const reason = whyUnlabellable(targets, max);
    if (reason !== null) return notify(reason);
    void setLabel(targets, label?.key ?? null, options);
  };
}
