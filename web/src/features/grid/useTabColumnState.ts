import { useCallback, useEffect, useRef } from 'react';
import type { ColumnState, GridApi } from 'ag-grid-community';
import { tabColumnState } from '../column-views';

/**
 * Keeps a grid's column state across its tab being hidden (TabHost uses `display:none`) and
 * re-created. The container's size drops to zero when hidden: state is saved then and restored
 * when it is visible again. Also saved on unmount and restored on `attach` (grid ready).
 * Without a `stateKey` this does nothing.
 */
export function useTabColumnState(stateKey: string | undefined) {
  const apiRef = useRef<GridApi | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const save = useCallback(() => {
    const api = apiRef.current;
    if (stateKey && api && !api.isDestroyed()) tabColumnState.set(stateKey, api.getColumnState());
  }, [stateKey]);

  const restore = useCallback(() => {
    const api = apiRef.current;
    const state = stateKey ? tabColumnState.get(stateKey) : undefined;
    if (api && !api.isDestroyed() && state) {
      api.applyColumnState({ state: state as ColumnState[], applyOrder: true });
    }
  }, [stateKey]);

  const attach = useCallback(
    (api: GridApi) => {
      apiRef.current = api;
      restore();
    },
    [restore],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!stateKey || !el || typeof ResizeObserver === 'undefined') return undefined;
    let hidden = false;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry?.contentRect ?? { width: 1, height: 1 };
      if (width === 0 && height === 0) {
        if (!hidden) save();
        hidden = true;
      } else if (hidden) {
        hidden = false;
        restore();
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      // Hidden tabs already saved; a visible grid saves whatever AG Grid has not yet reported.
      if (!hidden) save();
    };
  }, [stateKey, save, restore]);

  return { containerRef, attach, save };
}
