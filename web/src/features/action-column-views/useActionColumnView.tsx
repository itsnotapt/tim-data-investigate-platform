import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { GridApi } from 'ag-grid-community';
import { useContext, useEffect, useMemo, useRef } from 'react';
import { NotifyContext } from '../../components/notifyContext';
import type { ColumnView } from '../../lib/api';
import type { TabColumnView } from '../../lib/storage';
import { useTabsStore, type TabStateUpdate } from '../tabs';
import { scopeKey, useAppliedViewsStore } from './appliedViewsStore';
import { scopeOf, type ColumnViewScope } from './ranking';
import {
  fitColumnView,
  ignoredKeys,
  sameColumnView,
  columnViewStateOf,
  type ColumnViewState,
} from './columnViewState';
import { useSavedColumnViewsStore } from './savedColumnViewsStore';

export const ACTION_DEFAULT_NAME = 'Action default';

/** How long the grid state settles before the tab keeps it. */
const SETTLE_MS = 150;

/** What the Views panel and the status bar do to the tab's grid, through the grid's context. */
export interface ColumnViewController {
  uuid: string;
  /** Puts `view` on the tab's grid, or the action default for `null`. */
  pick(view: ColumnView | null): void;
  /** Puts the tab's column view back as it was picked. */
  revert(): void;
  /** PROTOTYPE: puts a grid state and the column view it came from back, for Undo. */
  restore(state: ColumnViewState, columnView: TabColumnView | null): void;
  /** The tab's grid state now. */
  current(): ColumnViewState | null;
}

/**
 * The tab's preset and action, which applied column views are keyed by; `null` if it isn't an
 * action tab.
 */
export function tabScope(uuid: string): ColumnViewScope | null {
  const tab = useTabsStore.getState().tabs[uuid];
  if (tab?.componentName !== 'ActionResult') return null;
  return scopeOf(tab.params);
}

const tabState = (uuid: string) => useTabsStore.getState().tabs[uuid]?.state;

/**
 * Keeps an action tab's grid in step with its column view: when the grid is ready it gets the
 * tab's own state if it has one, else the column view applied for the tab's preset or action, else
 * the action default, each fitted to the result. The tab then keeps the grid's column view
 * sections as they change.
 */
export function useActionColumnView(uuid: string) {
  const notify = useContext(NotifyContext);
  const apiRef = useRef<GridApi | null>(null);
  /** Off while a state is being put on the grid, so its own updates aren't kept. */
  const settled = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const controller = useMemo(() => {
    const update = (state: TabStateUpdate) => useTabsStore.getState().updateState(uuid, state);

    /** Resets the grid to the action default, then puts `view` (fitted) on it. */
    const putOn = (
      api: GridApi,
      view: ColumnViewState | null,
      picked: Omit<TabColumnView, 'baseline'> | null,
    ) => {
      settled.current = false;
      clearTimeout(timer.current);
      api.resetColumnState();
      const base = api.getState();
      const target = view
        ? fitColumnView(view, base)
        : { ...columnViewStateOf(base), filter: { filterModel: {} } };
      api.setState(target, ignoredKeys(target));
      // `setState` holds its events back until a timeout.
      setTimeout(() => {
        if (api.isDestroyed()) return;
        const now = columnViewStateOf(api.getState());
        update(
          picked
            ? { gridState: now, columnView: { ...picked, baseline: now } }
            : { gridState: now },
        );
        settled.current = true;
      }, 0);
    };

    const actionDefault = { viewId: null, name: ACTION_DEFAULT_NAME };

    /** Puts `view` on the grid, or the action default for `null`. */
    const putOnColumnView = (api: GridApi, view: ColumnView | null) =>
      putOn(
        api,
        view && view.state,
        view ? { viewId: view.viewId, name: view.name } : actionDefault,
      );

    /** The column view applied for the tab's scope, if it's still there; warns when it's gone. */
    const appliedView = async (): Promise<ColumnView | null> => {
      const scope = tabScope(uuid);
      const applied = scope && useAppliedViewsStore.getState().applied[scopeKey(scope)];
      if (!scope || !applied) return null;
      await useSavedColumnViewsStore.getState().refresh();
      const { views, error } = useSavedColumnViewsStore.getState();
      const view = views.find((v) => v.viewId === applied.viewId);
      if (view || error) return view ?? null;
      notify?.({
        message: `Column view "${applied.name}" is gone, so the tab starts with the action default.`,
        icon: <WarningAmberIcon fontSize="small" color="warning" />,
      });
      await useAppliedViewsStore.getState().clear(scope);
      return null;
    };

    const start = async (api: GridApi) => {
      apiRef.current = api;
      settled.current = false;
      const own = tabState(uuid)?.gridState;
      if (own) {
        putOn(api, own, null);
        return;
      }
      const view = await appliedView();
      if (api.isDestroyed()) return;
      putOnColumnView(api, view);
    };

    /** Keeps the grid's column view sections once they settle. */
    const keep = () => {
      if (!settled.current) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const api = apiRef.current;
        if (!settled.current || !api || api.isDestroyed()) return;
        const now = columnViewStateOf(api.getState());
        const before = tabState(uuid)?.gridState;
        if (!before || !sameColumnView(before, now)) update({ gridState: now });
      }, SETTLE_MS);
    };

    const columnViews: ColumnViewController = {
      uuid,
      pick(view) {
        const api = apiRef.current;
        if (!api || api.isDestroyed()) return;
        putOnColumnView(api, view);
      },
      revert() {
        const api = apiRef.current;
        const picked = tabState(uuid)?.columnView;
        if (!api || api.isDestroyed() || !picked) return;
        putOn(api, picked.baseline, null);
      },
      restore(state, columnView) {
        const api = apiRef.current;
        if (!api || api.isDestroyed()) return;
        update({ columnView });
        putOn(api, state, null);
      },
      current() {
        const api = apiRef.current;
        return api && !api.isDestroyed() ? columnViewStateOf(api.getState()) : null;
      },
    };
    return { start, keep, columnViews };
  }, [uuid, notify]);

  return controller;
}
