import { useMemo } from 'react';
import { useTabsStore } from '../tabs';
import { scopeKey, useDefaultViewsStore } from './defaultViewsStore';
import { isModified } from './columnViewState';
import { scopeOf, type ColumnViewScope } from './ranking';
import { BUILT_IN_NAME } from './useActionColumnView';

/**
 * An action tab's column view as the Views panel and the status bar show it: the column view it
 * started from or last picked, the default view of its preset or action, and whether the tab is
 * edited.
 */
export function useTabColumnView(tabId: string) {
  const tab = useTabsStore((s) => s.tabs[tabId]);
  const action = tab?.toRun.action;
  const presetId = tab?.toRun.presetId;
  const scope = useMemo<ColumnViewScope | null>(
    () => (action === undefined ? null : scopeOf({ action, presetId })),
    [action, presetId],
  );
  const columnView = tab?.grid.columnView ?? null;
  const gridState = tab?.grid.gridState ?? null;
  const defaultView = useDefaultViewsStore((s) =>
    scope ? s.defaults[scopeKey(scope)] : undefined,
  );
  const edited = useMemo(
    () => (columnView && gridState ? isModified(columnView.baseline, gridState) : false),
    [columnView, gridState],
  );
  return {
    scope,
    columnView,
    /** The column view's name; the Built-in view's is always `BUILT_IN_NAME`. */
    name: columnView && (columnView.viewId === null ? BUILT_IN_NAME : columnView.name),
    gridState,
    edited,
    /** The default view's entry; `undefined` when new tabs open with the Built-in view. */
    defaultView,
  };
}
