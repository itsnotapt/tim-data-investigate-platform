import type { MenuItemDef } from 'ag-grid-community';
import type { QueryOptions } from '../../lib/storage';
import type { QueryTemplate } from '../../lib/api';
import { buildTemplateMenuTree, type MenuNode } from '../new-query/templateMenuTree';

/** What the menu reports when a pivot item is chosen. */
interface PivotChoice {
  template: QueryTemplate;
  row: Record<string, unknown>;
  selectedRows: Record<string, unknown>[];
}

export type OnPivot = (choice: PivotChoice) => void;

/** Minimal slice of ag-grid's menu action params, so tests can fake it. */
export interface PivotActionParams {
  node: { data?: unknown } | null;
  api: { getSelectedNodes(): { data?: unknown }[] };
}

const byText = (a: string, b: string) => a.localeCompare(b);

/** Order: by path (joined), then by menu text. */
function sortTemplates(templates: readonly QueryTemplate[]): QueryTemplate[] {
  return [...templates].sort(
    (a, b) => byText(a.path.join(','), b.path.join(',')) || byText(a.menu, b.menu),
  );
}

function sortNodes(nodes: MenuNode[]): MenuNode[] {
  const title = (n: MenuNode) => (n.kind === 'folder' ? n.title : n.template.menu);
  return [...nodes]
    .sort((a, b) => (a.kind === b.kind ? byText(title(a), title(b)) : a.kind === 'folder' ? -1 : 1))
    .map((n) => (n.kind === 'folder' ? { ...n, children: sortNodes(n.children) } : n));
}

/** Targets of a menu action: selected rows, or the clicked row when nothing is selected. */
function pivotTargets(params: PivotActionParams): {
  row: Record<string, unknown>;
  selectedRows: Record<string, unknown>[];
} {
  const row = (params.node?.data ?? {}) as Record<string, unknown>;
  const selected = params.api
    .getSelectedNodes()
    .map((n) => n.data as Record<string, unknown> | undefined)
    .filter((d): d is Record<string, unknown> => d !== undefined);
  return { row, selectedRows: selected.length > 0 ? selected : [row] };
}

/**
 * Nested context menu of the non-hidden `query` templates,
 * folders by path (keyed by the full path), sorted, never disabled. Empty when no
 * templates qualify.
 */
export function buildPivotMenuItems(
  templates: readonly QueryTemplate[],
  queryOptions: QueryOptions,
  onPivot: OnPivot,
): MenuItemDef[] {
  const tree = sortNodes(
    buildTemplateMenuTree(sortTemplates(templates), { queryType: 'query', queryOptions }),
  );
  const toItem = (node: MenuNode): MenuItemDef =>
    node.kind === 'folder'
      ? { name: node.title, subMenu: node.children.map(toItem) }
      : {
          name: node.template.menu,
          action: (params) => onPivot({ template: node.template, ...pivotTargets(params) }),
        };
  return tree.map(toItem);
}
