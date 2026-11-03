import type { RowClassRules } from 'ag-grid-community';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { GridRowWithId } from '../grid/columns';
import { useTabsStore } from '../tabs/tabStore';
import './pivotRows.css';

/** The pivot rows an action tab's grid shows Go to pivot row and Highlight pivot rows for. */
export interface PivotRows {
  /** The pivot rows' `id`s, each `null` for a row without one. */
  rowIds: readonly (string | null)[];
  /** The `id`s among them. */
  ids: ReadonlySet<string>;
}

/** Each tab's pivot rows, while its grid shows them. */
const shown = new Map<string, PivotRows>();
/** The tabs with Highlight pivot rows unticked; it is ticked when a tab opens. In memory only. */
const unticked = new Set<string>();
const listeners = new Set<() => void>();

function tell(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Shows the pivot rows of the tab's grid while the caller is mounted: `null` (no pivot rows, or an
 * action that doesn't find them) shows none.
 */
export function useShowPivotRows(tabId: string, rowIds: readonly (string | null)[] | null): void {
  useEffect(() => {
    if (!rowIds) return;
    const ids = new Set(rowIds.filter((id): id is string => id !== null));
    shown.set(tabId, { rowIds, ids });
    tell();
    return () => {
      shown.delete(tabId);
      tell();
    };
  }, [tabId, rowIds]);
}

/** The pivot rows the tab's grid shows, else `null`. */
export function usePivotRows(tabId: string): PivotRows | null {
  return useSyncExternalStore(subscribe, () => shown.get(tabId) ?? null);
}

function setHighlight(tabId: string, on: boolean): void {
  if (on === !unticked.has(tabId)) return;
  if (on) unticked.delete(tabId);
  else unticked.add(tabId);
  tell();
}

/** Whether the tab's Highlight pivot rows is ticked, and the setter of its tick. */
export function usePivotRowHighlight(tabId: string): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => !unticked.has(tabId));
  const set = useCallback((next: boolean) => setHighlight(tabId, next), [tabId]);
  return [on, set];
}

/**
 * Row class rules of the pivot rows: `tim-pivot-row` on each row whose `id` is one of `ids` while
 * `highlight` is on. The rule stays when `highlight` is off, so the grid takes the class off again.
 */
export function pivotRowClassRules(
  ids: ReadonlySet<string>,
  highlight: boolean,
): RowClassRules<GridRowWithId> {
  return {
    'tim-pivot-row': (p) => {
      const id = p.data?.id;
      return highlight && typeof id === 'string' && ids.has(id);
    },
  };
}

// A closed tab's tick is let go.
useTabsStore.subscribe(({ tabs }) => {
  for (const tabId of unticked) if (!(tabId in tabs)) unticked.delete(tabId);
});
