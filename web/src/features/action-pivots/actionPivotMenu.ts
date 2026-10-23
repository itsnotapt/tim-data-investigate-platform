import type { MenuItemDef } from 'ag-grid-community';
import type { CatalogueAction } from '../../lib/api';
import { buildActionMenuTree, type MenuNode } from '../new-query/menuTree';

export interface ActionPivotMenuInput {
  actions: readonly CatalogueAction[];
  /** The targets' values by column: the selected rows, or the right-clicked row. */
  rows: readonly Record<string, unknown>[];
  maxPivotRows: number;
  /** Keys of the analyst's recent pivots, the latest first. */
  recent: readonly string[];
  onPivot: (action: CatalogueAction) => void;
}

/** Whether `action` is a query action and every row has a column from each of its pivot column groups. */
const pivotsFrom = (action: CatalogueAction, rows: readonly Record<string, unknown>[]) =>
  action.kind === 'query' &&
  action.pivot !== null &&
  rows.every((row) => action.pivot!.columns.every((group) => group.some((c) => c in row)));

const count = (n: number) => n.toLocaleString('en');

/**
 * The Pivot ▸ item of an action tab's context menu: Recent, the analyst's recent pivots by their
 * full menu path, then the actions by menu path. It lists the query actions whose `pivot` columns
 * the rows have. A one-row action is disabled for several rows, and the whole item over
 * `maxPivotRows`, each with the reason. Empty when no action pivots from the rows.
 */
export function buildActionPivotMenu({
  actions,
  rows,
  maxPivotRows,
  recent,
  onPivot,
}: ActionPivotMenuInput): MenuItemDef[] {
  const offered = actions.filter((a) => pivotsFrom(a, rows));
  if (offered.length === 0) return [];
  if (rows.length > maxPivotRows) {
    return [
      {
        name: 'Pivot',
        disabled: true,
        tooltip: `At most ${count(maxPivotRows)} rows; ${count(rows.length)} selected`,
      },
    ];
  }
  const item = (action: CatalogueAction, name: string): MenuItemDef =>
    action.pivot?.rows === 'row' && rows.length > 1
      ? { name, disabled: true, tooltip: 'Takes one row' }
      : { name, action: () => onPivot(action) };
  const toItem = (node: MenuNode<CatalogueAction>): MenuItemDef =>
    node.kind === 'folder'
      ? { name: node.title, subMenu: node.children.map(toItem) }
      : item(node.item, node.label);
  const recentItems = recent.flatMap((key) => {
    const action = offered.find((a) => a.key === key);
    return action ? [item(action, [...action.menuPath, action.name].join(' / '))] : [];
  });
  return [
    {
      name: 'Pivot',
      subMenu: [
        ...(recentItems.length > 0
          ? [{ name: 'Recent', disabled: true }, ...recentItems, 'separator']
          : []),
        ...buildActionMenuTree(offered).map(toItem),
      ],
    },
  ];
}
