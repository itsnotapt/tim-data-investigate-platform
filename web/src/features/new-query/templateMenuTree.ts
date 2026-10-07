import type { QueryOptions, QueryTemplate, QueryType } from './types';

interface MenuFolderNode {
  kind: 'folder';
  /** Full path joined with a separator that cannot occur in a segment; unique per path. */
  key: string;
  title: string;
  children: MenuNode[];
}
interface MenuItemNode {
  kind: 'item';
  key: string;
  template: QueryTemplate;
}
export type MenuNode = MenuFolderNode | MenuItemNode;

const SEP = '\u0000';

/** Case-insensitive substring match over menu text + summary. */
function matchesSearch(t: QueryTemplate, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return `${t.menu}\n${t.summary}`.toLowerCase().includes(needle);
}

export interface BuildMenuOptions {
  queryType: QueryType;
  search?: string;
  queryOptions?: QueryOptions;
}

/**
 * Nested menu for one template type. Folders are keyed by the FULL path, so the same segment
 * name under different parents yields separate folders.
 * Hidden templates (`queryOptions[uuid].hide === true`) are excluded; insertion order is kept.
 * Within a folder, subfolders come first, then templates.
 */
export function buildTemplateMenuTree(
  templates: readonly QueryTemplate[],
  { queryType, search = '', queryOptions = {} }: BuildMenuOptions,
): MenuNode[] {
  const root: MenuFolderNode = { kind: 'folder', key: '', title: '', children: [] };
  const folders = new Map<string, MenuFolderNode>();
  for (const t of templates) {
    if (t.queryType !== queryType) continue;
    if (queryOptions[t.uuid]?.hide === true) continue;
    if (!matchesSearch(t, search)) continue;
    let parent = root;
    const segments: string[] = [];
    for (const segment of t.path) {
      segments.push(segment);
      const key = segments.join(SEP);
      let folder = folders.get(key);
      if (!folder) {
        folder = { kind: 'folder', key, title: segment, children: [] };
        folders.set(key, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }
    parent.children.push({ kind: 'item', key: t.uuid, template: t });
  }
  const order = (nodes: MenuNode[]): MenuNode[] => {
    const f = nodes.filter((n) => n.kind === 'folder');
    const i = nodes.filter((n) => n.kind === 'item');
    for (const n of f) n.children = order(n.children);
    return [...f, ...i];
  };
  return order(root.children);
}
