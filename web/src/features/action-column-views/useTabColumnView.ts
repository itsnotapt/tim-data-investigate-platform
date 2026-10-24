import { useMemo } from 'react';
import { useTabsStore } from '../tabs';
import { scopeKey, useAppliedViewsStore } from './appliedViewsStore';
import { isModified } from './columnViewState';
import { scopeOf, type ColumnViewScope } from './ranking';

/**
 * An action tab's column view as the Views panel and the status bar show it: the column view it
 * started from or last picked, whether that's the one new tabs start with, and whether the tab
 * changed it.
 */
export function useTabColumnView(uuid: string) {
  const tab = useTabsStore((s) => s.tabs[uuid]);
  const params = tab?.componentName === 'ActionResult' ? tab.params : undefined;
  const action = params?.action;
  const presetId = params?.presetId;
  const scope = useMemo<ColumnViewScope | null>(
    () => (action === undefined ? null : scopeOf({ action, presetId })),
    [action, presetId],
  );
  const columnView = tab?.state.columnView ?? null;
  const gridState = tab?.state.gridState ?? null;
  const entry = useAppliedViewsStore((s) => (scope ? s.applied[scopeKey(scope)] : undefined));
  const modified = useMemo(
    () => (columnView && gridState ? isModified(columnView.baseline, gridState) : false),
    [columnView, gridState],
  );
  /** The column view new tabs for the scope start with; `null` for the action default. */
  const appliedId = entry?.viewId ?? null;
  return {
    scope,
    columnView,
    gridState,
    modified,
    /** The applied column view's entry, when one is applied (not the action default). */
    entry,
    applied: columnView !== null && columnView.viewId === appliedId,
  };
}
