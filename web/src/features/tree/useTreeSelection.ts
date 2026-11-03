import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  selectAncestors,
  selectSubtreeIds,
  useTabsStore,
  type TabsData,
  type TabsStore,
} from '../tabs';

/**
 * Check/uncheck rules:
 * - checking a node checks it and all descendants;
 * - unchecking a node unchecks it, all descendants and all ancestors;
 * - checking every child does not check the parent on its own.
 * Pure; returns a new set.
 */
export function toggleChecked(
  data: TabsData,
  checked: ReadonlySet<string>,
  tabId: string,
  value: boolean,
): Set<string> {
  const next = new Set(checked);
  if (!(tabId in data.tabs)) return next;
  if (value) {
    for (const id of selectSubtreeIds(data, tabId)) next.add(id);
  } else {
    for (const id of selectSubtreeIds(data, tabId)) next.delete(id);
    for (const a of selectAncestors(data, tabId)) next.delete(a.id);
  }
  return next;
}

/** Drops tab ids that no longer exist. */
function pruneChecked(data: TabsData, checked: ReadonlySet<string>): Set<string> {
  return new Set([...checked].filter((id) => id in data.tabs));
}

export interface TreeSelection {
  checked: ReadonlySet<string>;
  toggle(tabId: string, value: boolean): void;
  clear(): void;
  /** Removes every checked tab (the store cascades to descendants); `/` if the active tab went. */
  removeSelected(): Promise<void>;
}

export function useTreeSelection(
  activeTabId: string | undefined,
  store: TabsStore = useTabsStore,
): TreeSelection {
  const navigate = useNavigate();
  const [raw, setRaw] = useState<ReadonlySet<string>>(new Set());
  const tabs = store((s) => s.tabs);
  const order = store((s) => s.order);
  const checked = useMemo(() => pruneChecked({ tabs, order }, raw), [tabs, order, raw]);

  const toggle = useCallback(
    (tabId: string, value: boolean) => {
      setRaw((prev) =>
        toggleChecked(store.getState(), pruneChecked(store.getState(), prev), tabId, value),
      );
    },
    [store],
  );
  const clear = useCallback(() => setRaw(new Set()), []);

  const removeSelected = useCallback(async () => {
    const ids = [...pruneChecked(store.getState(), raw)];
    for (const id of ids) await store.getState().removeTab(id);
    setRaw(new Set());
    if (activeTabId && !(activeTabId in store.getState().tabs)) {
      void navigate('/', { replace: true });
    }
  }, [store, raw, activeTabId, navigate]);

  return { checked, toggle, clear, removeSelected };
}
