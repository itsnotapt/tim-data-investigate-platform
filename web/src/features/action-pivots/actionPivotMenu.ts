import type { MenuItemDef } from 'ag-grid-community';
import type { CatalogueAction, InstanceConnection, Preset } from '../../lib/api';
import { buildNewMenuTree, type MenuNode, type NewMenuEntry } from '../new-query/menuTree';
import { presetPivot, type PresetPivotDisabled, type PresetPivotParams } from '../presets';

export interface ActionPivotMenuInput {
  actions: readonly CatalogueAction[];
  presets: readonly Preset[];
  connections: readonly InstanceConnection[];
  /** The targets' values by column: the selected rows, or the right-clicked row. */
  rows: readonly Record<string, unknown>[];
  maxPivotRows: number;
  /** Keys of the analyst's recent pivots, the latest first: see `recentPivotKey`. */
  recent: readonly string[];
  onPivot: (action: CatalogueAction) => void;
  /** Pivots with a preset of `action`, its params resolved from the rows. */
  onPivotPreset: (preset: Preset, action: CatalogueAction, resolved: PresetPivotParams) => void;
}

/** The key of a recent pivot: the action's key, or `preset:` and the preset's id. */
export const recentPivotKey = (item: CatalogueAction | Preset): string =>
  'presetId' in item ? `preset:${item.presetId}` : item.key;

/**
 * Whether `action` is a query action and every row has a column from each of its pivot column
 * groups.
 */
const pivotsFrom = (action: CatalogueAction, rows: readonly Record<string, unknown>[]) =>
  action.kind === 'query' &&
  action.pivot !== null &&
  rows.every((row) => action.pivot!.columns.every((group) => group.some((c) => c in row)));

const count = (n: number) => n.toLocaleString('en');

/**
 * The Pivot ▸ item of an action tab's context menu: Recent, the analyst's recent pivots by their
 * full menu path, then the actions and presets by menu path. It lists the query actions whose
 * `pivot` columns the rows have, and the presets that pivot from them (`presetPivot`), except
 * hidden ones. A one-row action is disabled for several rows, a preset whose rows disagree on a
 * value, and the whole item over `maxPivotRows`, each with the reason. Empty when nothing pivots
 * from the rows.
 */
export function buildActionPivotMenu({
  actions,
  presets,
  connections,
  rows,
  maxPivotRows,
  recent,
  onPivot,
  onPivotPreset,
}: ActionPivotMenuInput): MenuItemDef[] {
  const byKey = new Map(actions.map((a) => [a.key, a]));
  const resolved = new Map<
    string,
    { action: CatalogueAction; pivot: PresetPivotParams | PresetPivotDisabled }
  >();
  for (const preset of presets) {
    const action = byKey.get(preset.action);
    const pivot = !preset.hidden && action && presetPivot(preset, action, rows, connections);
    if (pivot) resolved.set(preset.presetId, { action, pivot });
  }
  const offeredActions = actions.filter((a) => pivotsFrom(a, rows));
  const offeredPresets = presets.filter((p) => resolved.has(p.presetId));
  const tree = buildNewMenuTree(offeredActions, offeredPresets, {});
  if (tree.length === 0) return [];
  if (rows.length > maxPivotRows) {
    return [
      {
        name: 'Pivot',
        disabled: true,
        tooltip: `At most ${count(maxPivotRows)} rows; ${count(rows.length)} selected`,
      },
    ];
  }
  const item = (entry: NewMenuEntry, name: string): MenuItemDef => {
    if (entry.kind === 'action') {
      const { action } = entry;
      return action.pivot?.rows === 'row' && rows.length > 1
        ? { name, disabled: true, tooltip: 'Takes one row' }
        : { name, action: () => onPivot(action) };
    }
    const { preset } = entry;
    const { action, pivot } = resolved.get(preset.presetId)!;
    return 'disabled' in pivot
      ? { name, disabled: true, tooltip: pivot.disabled }
      : { name, action: () => onPivotPreset(preset, action, pivot) };
  };
  const toItem = (node: MenuNode<NewMenuEntry>): MenuItemDef =>
    node.kind === 'folder'
      ? { name: node.title, subMenu: node.children.map(toItem) }
      : item(node.item, node.label);
  const fullPath = ({ menuPath = [], name }: { menuPath?: string[]; name: string }) =>
    [...menuPath, name].join(' / ');
  const byRecentKey = new Map<string, MenuItemDef>([
    ...offeredActions.map((action): [string, MenuItemDef] => [
      recentPivotKey(action),
      item({ kind: 'action', action }, fullPath(action)),
    ]),
    ...offeredPresets.map((preset): [string, MenuItemDef] => [
      recentPivotKey(preset),
      item({ kind: 'preset', preset, action: undefined }, fullPath(preset)),
    ]),
  ]);
  const recentItems = recent.flatMap((key) => byRecentKey.get(key) ?? []);
  return [
    {
      name: 'Pivot',
      subMenu: [
        ...(recentItems.length > 0
          ? [{ name: 'Recent', disabled: true }, ...recentItems, 'separator']
          : []),
        ...tree.map(toItem),
      ],
    },
  ];
}
