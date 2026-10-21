import type { CatalogueAction } from '../../lib/api';
import type { QueryOptions, QueryTemplate, QueryType } from './types';

interface MenuFolderNode<T> {
  kind: 'folder';
  /** Full path joined with a separator that cannot occur in a segment; unique per path. */
  key: string;
  title: string;
  children: MenuNode<T>[];
}
interface MenuItemNode<T> {
  kind: 'item';
  key: string;
  label: string;
  item: T;
}
export type MenuNode<T> = MenuFolderNode<T> | MenuItemNode<T>;

interface MenuEntry<T> {
  key: string;
  label: string;
  path: readonly string[];
  item: T;
}

const SEP = '\u0000';

/** Case-insensitive substring match of `search` in any of `texts`. */
function matchesSearch(texts: readonly string[], search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return texts.join('\n').toLowerCase().includes(needle);
}

/**
 * Nested menu. Folders are keyed by the FULL path, so the same segment name under different
 * parents yields separate folders. Insertion order is kept; within a folder, subfolders come
 * first, then items.
 */
function buildMenuTree<T>(entries: readonly MenuEntry<T>[]): MenuNode<T>[] {
  const root: MenuFolderNode<T> = { kind: 'folder', key: '', title: '', children: [] };
  const folders = new Map<string, MenuFolderNode<T>>();
  for (const entry of entries) {
    let parent = root;
    const segments: string[] = [];
    for (const segment of entry.path) {
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
    parent.children.push({ kind: 'item', key: entry.key, label: entry.label, item: entry.item });
  }
  const order = (nodes: MenuNode<T>[]): MenuNode<T>[] => {
    const f = nodes.filter((n) => n.kind === 'folder');
    const i = nodes.filter((n) => n.kind === 'item');
    for (const n of f) n.children = order(n.children);
    return [...f, ...i];
  };
  return order(root.children);
}

export interface BuildMenuOptions {
  queryType: QueryType;
  search?: string;
  queryOptions?: QueryOptions;
}

/**
 * Nested menu for one template type, searched over menu text and summary.
 * Hidden templates (`queryOptions[uuid].hide === true`) are excluded.
 */
export function buildTemplateMenuTree(
  templates: readonly QueryTemplate[],
  { queryType, search = '', queryOptions = {} }: BuildMenuOptions,
): MenuNode<QueryTemplate>[] {
  return buildMenuTree(
    templates
      .filter(
        (t) =>
          t.queryType === queryType &&
          queryOptions[t.uuid]?.hide !== true &&
          matchesSearch([t.menu, t.summary], search),
      )
      .map((t) => ({ key: t.uuid, label: t.menu, path: t.path, item: t })),
  );
}

/** Nested menu of actions under their menu paths, searched over name, folders and key. */
export function buildActionMenuTree(
  actions: readonly CatalogueAction[],
  search = '',
): MenuNode<CatalogueAction>[] {
  return buildMenuTree(
    actions
      .filter((a) => matchesSearch([a.name, ...a.menuPath, a.key], search))
      .map((a) => ({ key: a.key, label: a.name, path: a.menuPath, item: a })),
  );
}
