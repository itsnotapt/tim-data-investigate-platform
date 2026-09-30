import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import type { GetExtraContextMenuItems } from '../grid';
import { useTabsStore, type TabsStore } from '../tabs';
import { useTemplatesStore } from '../templates';
import { createPivotTab } from './createPivotTab';
import { buildPivotMenuItems } from './pivotMenu';

/** Tracks whether Shift is held (legacy `keydown`/`keyup` listener); cleared on window blur. */
export function useShiftHeld(): { current: boolean } {
  const held = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Shift') held.current = e.type === 'keydown';
    };
    const onBlur = () => {
      held.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return held;
}

/**
 * `getContextMenuItems` provider for `ResultsGrid` that lists the query templates as pivots of the
 * tab `parentUuid` (W4). Holding Shift while choosing one creates the child without running it.
 */
export function usePivotMenu(
  parentUuid: string,
  store: TabsStore = useTabsStore,
): GetExtraContextMenuItems {
  const templates = useTemplatesStore((s) => s.templates);
  const queryOptions = useTemplatesStore((s) => s.queryOptions);
  const navigate = useNavigate();
  const shift = useShiftHeld();
  return useMemo(() => {
    const items = buildPivotMenuItems(templates, queryOptions, (choice) => {
      void createPivotTab({
        ...choice,
        parentUuid,
        autoExecute: !shift.current,
        navigate,
        store,
      });
    });
    return () => items;
  }, [templates, queryOptions, parentUuid, navigate, shift, store]);
}
