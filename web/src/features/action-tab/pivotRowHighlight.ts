import type { RowClassRules } from 'ag-grid-community';
import { useCallback, useSyncExternalStore } from 'react';
import type { GridRowWithId } from '../grid/columns';
import { useTabsStore } from '../tabs/tabStore';
import './pivotRowHighlight.css';

/** The tabs with Highlight pivot rows unticked; it is ticked when a tab opens. In memory only. */
const unticked = new Set<string>();
const listeners = new Set<() => void>();

function setHighlight(tabId: string, on: boolean): void {
  if (on === !unticked.has(tabId)) return;
  if (on) unticked.delete(tabId);
  else unticked.add(tabId);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
