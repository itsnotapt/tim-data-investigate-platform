import type { MenuItemDef } from 'ag-grid-community';
import type { CatalogueAction } from '../../lib/api';
import { buildActionMenuTree, type MenuNode } from '../new-query/menuTree';

export interface SinkMenuInput {
  /** The catalogue's actions; only its sinks are listed. */
  actions: readonly CatalogueAction[];
  /** How many rows the sink would take: the selected rows. */
  rowCount: number;
  /** `maxAnnotationIds`: the most rows a sink takes. */
  max: number;
  onRun: (sink: CatalogueAction) => void;
}

const count = (n: number) => n.toLocaleString('en');

/** Why no sink can take `rowCount` rows, over `max`: `maxAnnotationIds`. */
export function whyNoSink(rowCount: number, max: number): string | null {
  return rowCount > max ? `At most ${count(max)} rows; ${count(rowCount)} selected` : null;
}

/**
 * The context menu's sink items, under each sink's menu path. Over `max` rows each is disabled
 * with the reason. Empty when no sink is installed.
 */
export function buildSinkMenu({ actions, rowCount, max, onRun }: SinkMenuInput): MenuItemDef[] {
  const sinks = actions.filter((a) => a.kind === 'sink');
  const tooltip = whyNoSink(rowCount, max);
  const toItem = (node: MenuNode<CatalogueAction>): MenuItemDef =>
    node.kind === 'folder'
      ? { name: node.title, subMenu: node.children.map(toItem) }
      : tooltip
        ? { name: node.label, disabled: true, tooltip }
        : { name: node.label, action: () => onRun(node.item) };
  return buildActionMenuTree(sinks).map(toItem);
}
