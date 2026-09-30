import type { Tab } from './types';

/** The slice of store state the selectors need. */
export interface TabsData {
  tabs: Record<string, Tab>;
  /** All uuids in load/creation order (parents before children). */
  order: string[];
}

export const selectTab = (s: TabsData, uuid: string): Tab | undefined => s.tabs[uuid];

export const selectIsTab = (s: TabsData, uuid: string): boolean => uuid in s.tabs;

export function selectChildrenOf(s: TabsData, uuid: string): Tab[] {
  return selectAllInOrder(s).filter((t) => t.parentUuid === uuid);
}

/** Roots in order; a tab whose parent is missing counts as a root. */
export function selectRoots(s: TabsData): Tab[] {
  return selectAllInOrder(s).filter((t) => t.parentUuid === null || !(t.parentUuid in s.tabs));
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
export function selectAncestors(s: TabsData, uuid: string): Tab[] {
  const path: Tab[] = [];
  const seen = new Set<string>([uuid]);
  let current = s.tabs[uuid];
  while (current?.parentUuid != null && !seen.has(current.parentUuid)) {
    const parent = s.tabs[current.parentUuid];
    if (!parent) break;
    seen.add(parent.componentUuid);
    path.unshift(parent);
    current = parent;
  }
  return path;
}

/** The tab and all its descendants (pre-order, tab first). */
export function selectSubtreeUuids(s: TabsData, uuid: string): string[] {
  if (!(uuid in s.tabs)) return [];
  const byParent = new Map<string, string[]>();
  for (const t of selectAllInOrder(s)) {
    if (t.parentUuid === null) continue;
    const list = byParent.get(t.parentUuid) ?? [];
    list.push(t.componentUuid);
    byParent.set(t.parentUuid, list);
  }
  const out: string[] = [];
  const stack = [uuid];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    stack.push(...[...(byParent.get(id) ?? [])].reverse());
  }
  return out;
}
