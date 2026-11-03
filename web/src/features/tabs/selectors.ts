import type { Tab } from './types';

/** The slice of store state the selectors need. */
export interface TabsData {
  tabs: Record<string, Tab>;
  /** All ids in load/creation order (parents before children). */
  order: string[];
}

export const selectTab = (s: TabsData, id: string): Tab | undefined => s.tabs[id];

export function selectChildrenOf(s: TabsData, id: string): Tab[] {
  return selectAllInOrder(s).filter((t) => t.parentId === id);
}

/** Roots in order; a tab whose parent is missing counts as a root. */
export function selectRoots(s: TabsData): Tab[] {
  return selectAllInOrder(s).filter((t) => t.parentId === null || !(t.parentId in s.tabs));
}

export function selectAllInOrder(s: TabsData): Tab[] {
  const out: Tab[] = [];
  for (const id of s.order) {
    const t = s.tabs[id];
    if (t) out.push(t);
  }
  return out;
}

/** Ancestors from the root down to the direct parent (excludes the tab itself). Cycle safe. */
export function selectAncestors(s: TabsData, id: string): Tab[] {
  const path: Tab[] = [];
  const seen = new Set<string>([id]);
  let current = s.tabs[id];
  while (current?.parentId != null && !seen.has(current.parentId)) {
    const parent = s.tabs[current.parentId];
    if (!parent) break;
    seen.add(parent.id);
    path.unshift(parent);
    current = parent;
  }
  return path;
}

/** The tab and all its descendants (pre-order, tab first). */
export function selectSubtreeIds(s: TabsData, id: string): string[] {
  if (!(id in s.tabs)) return [];
  const byParent = new Map<string, string[]>();
  for (const t of selectAllInOrder(s)) {
    if (t.parentId === null) continue;
    const list = byParent.get(t.parentId) ?? [];
    list.push(t.id);
    byParent.set(t.parentId, list);
  }
  const out: string[] = [];
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    stack.push(...[...(byParent.get(next) ?? [])].reverse());
  }
  return out;
}
