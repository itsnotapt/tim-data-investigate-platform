import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  selectAncestors,
  selectSubtreeUuids,
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
  uuid: string,
  value: boolean,
): Set<string> {
  const next = new Set(checked);
  if (!(uuid in data.tabs)) return next;
  if (value) {
    for (const id of selectSubtreeUuids(data, uuid)) next.add(id);
  } else {
    for (const id of selectSubtreeUuids(data, uuid)) next.delete(id);
    for (const a of selectAncestors(data, uuid)) next.delete(a.componentUuid);
  }
  return next;
}

/** Drops uuids that no longer exist. */
function pruneChecked(data: TabsData, checked: ReadonlySet<string>): Set<string> {
  return new Set([...checked].filter((id) => id in data.tabs));
}

export interface TreeSelection {
  checked: ReadonlySet<string>;
  toggle(uuid: string, value: boolean): void;
  clear(): void;
  /** Removes every checked tab (the store cascades to descendants); `/` if the active tab went. */
  removeSelected(): Promise<void>;
}

export function useTreeSelection(
  activeUuid: string | undefined,
  store: TabsStore = useTabsStore,
): TreeSelection {
  const navigate = useNavigate();
  const [raw, setRaw] = useState<ReadonlySet<string>>(new Set());
  const tabs = store((s) => s.tabs);
  const order = store((s) => s.order);
  const checked = useMemo(() => pruneChecked({ tabs, order }, raw), [tabs, order, raw]);

  const toggle = useCallback(
    (uuid: string, value: boolean) => {
      setRaw((prev) =>
        toggleChecked(store.getState(), pruneChecked(store.getState(), prev), uuid, value),
      );
    },
    [store],
  );
  const clear = useCallback(() => setRaw(new Set()), []);

  const removeSelected = useCallback(async () => {
    const ids = [...pruneChecked(store.getState(), raw)];
    for (const id of ids) await store.getState().removeTab(id);
    setRaw(new Set());
    if (activeUuid && !(activeUuid in store.getState().tabs)) {
      void navigate('/', { replace: true });
    }
  }, [store, raw, activeUuid, navigate]);

  return { checked, toggle, clear, removeSelected };
}
