import type { CatalogueAction, Preset } from '../../lib/api';
import type { QueryOptions, QueryTemplate, QueryType } from './types';

interface MenuFolderNode<T> {
  kind: 'folder';
  /** Full path joined with a separator that cannot occur in a segment; unique per path. */
  key: string;
  title: string;
  /** Items anywhere below the folder. */
  count: number;
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
  const root: MenuFolderNode<T> = { kind: 'folder', key: '', title: '', count: 0, children: [] };
  const folders = new Map<string, MenuFolderNode<T>>();
  for (const entry of entries) {
    let parent = root;
    const segments: string[] = [];
    for (const segment of entry.path) {
      segments.push(segment);
      const key = segments.join(SEP);
      let folder = folders.get(key);
      if (!folder) {
        folder = { kind: 'folder', key, title: segment, count: 0, children: [] };
        folders.set(key, folder);
        parent.children.push(folder);
      }
      folder.count += 1;
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

/** Which presets the New menu shows: All (with the actions), Mine, Others' or Hidden. */
export type NewMenuFilter = 'all' | 'mine' | 'others' | 'hidden';

/** An item of the New menu: an action, or a preset with its action when it is in the catalogue. */
export type NewMenuEntry =
  | { kind: 'action'; action: CatalogueAction }
  | { kind: 'preset'; preset: Preset; action: CatalogueAction | undefined };

export interface BuildNewMenuOptions {
  search?: string;
  filter?: NewMenuFilter;
}

const fromColumns = (preset: Preset): string[] =>
  (preset.inputs ?? []).flatMap((i) => (i.fixed ? [] : i.fromColumns));

function presetShown(preset: Preset, filter: NewMenuFilter): boolean {
  if (filter === 'hidden') return preset.hidden;
  if (preset.hidden) return false;
  if (filter === 'mine') return preset.owned;
  if (filter === 'others') return !preset.owned;
  return true;
}

/**
 * Query actions and presets in one tree of folders, the actions first within each folder. Only
 * All lists actions; sinks, which run only on rows, are left out. Search covers name, folders,
 * action, owner and From columns.
 */
export function buildNewMenuTree(
  actions: readonly CatalogueAction[],
  presets: readonly Preset[],
  { search = '', filter = 'all' }: BuildNewMenuOptions,
): MenuNode<NewMenuEntry>[] {
  const byKey = new Map(actions.map((a) => [a.key, a]));
  const actionEntries: MenuEntry<NewMenuEntry>[] =
    filter === 'all'
      ? actions
          .filter(
            (a) => a.kind === 'query' && matchesSearch([a.name, ...a.menuPath, a.key], search),
          )
          .map((a) => ({
            key: `action:${a.key}`,
            label: a.name,
            path: a.menuPath,
            item: { kind: 'action', action: a },
          }))
      : [];
  const presetEntries: MenuEntry<NewMenuEntry>[] = presets
    .filter((p) => presetShown(p, filter))
    .filter((p) => {
      const action = byKey.get(p.action);
      const texts = [p.name, ...(p.menuPath ?? []), p.action, p.owner, ...fromColumns(p)];
      return matchesSearch(action ? [...texts, action.name] : texts, search);
    })
    .map((p) => ({
      key: `preset:${p.presetId}`,
      label: p.name,
      path: p.menuPath ?? [],
      item: { kind: 'preset', preset: p, action: byKey.get(p.action) },
    }));
  return buildMenuTree([...actionEntries, ...presetEntries]);
}

/**
 * The line under a preset: a bookmark (every input fixed) and its owner, or its action with the
 * columns it pivots on and the values it asks for. An action has none.
 */
export function entryCaption(entry: NewMenuEntry): string {
  if (entry.kind === 'action') return '';
  const { preset, action } = entry;
  const fromRow = (preset.inputs ?? []).filter((i) => !i.fixed);
  if (fromRow.length === 0) return `Bookmark · ${preset.owner}`;
  const title = (name: string) => action?.params.find((p) => p.name === name)?.title ?? name;
  const columns = fromColumns(preset);
  const asks = fromRow.filter((i) => !i.fixed && i.fromColumns.length === 0);
  return [
    action?.name ?? preset.action,
    ...(columns.length > 0 ? [`pivot on ${columns.join(', ')}`] : []),
    ...(asks.length > 0 ? [`asks for ${asks.map((i) => title(i.name)).join(', ')}`] : []),
  ].join(' · ');
}
