import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useNotify } from '../../components/useNotify';
import { resultRows } from '../action-tab/results';
import type { RowsMenu } from '../grid';
import { useInstanceStore } from '../instance';
import { usePresetsStore } from '../presets';
import { buildActionPivotMenu, recentPivotKey } from './actionPivotMenu';
import { pivotIntoAction, pivotIntoPreset } from './pivotIntoAction';
import { useRecentPivots } from './recentPivots';

/**
 * Context menu items for the grid of the action tab `parentTabId`: Pivot ▸ into the actions and
 * with the presets, which it loads unless they are already. It pivots from the targets' rows and
 * `id`s as the tab's Results have them when an item is picked. `run` runs a child tab that needs
 * nothing.
 */
export function useActionPivotMenu(parentTabId: string, run: (tabId: string) => void): RowsMenu {
  const instance = useInstanceStore((s) => s.instance);
  const recent = useRecentPivots((s) => s.keys);
  const record = useRecentPivots((s) => s.record);
  const presets = usePresetsStore((s) => s.presets);
  const presetsLoaded = usePresetsStore((s) => s.loaded);
  const notify = useNotify();
  const navigate = useNavigate();
  useEffect(() => {
    if (!presetsLoaded) void usePresetsStore.getState().refresh();
  }, [presetsLoaded]);
  return useMemo(
    () => (targets) => {
      if (!instance) return [];
      /** The targets' rows, and the clicked cell, as the tab's Results have them now. */
      const now = () => {
        const found = resultRows(parentTabId, targets.rows);
        const { row, column } = targets;
        const [clicked] = resultRows(parentTabId, row === null ? [] : [row]);
        return {
          rows: found.map((r) => r.data),
          pivotRowIds: found.map((r) => r.id ?? null),
          cell:
            column !== null && clicked && column in clicked.data
              ? { column, value: clicked.data[column] }
              : null,
        };
      };
      const goTo = (tabId: string) => void navigate(`/view/${tabId}`);
      return buildActionPivotMenu({
        actions: instance.actions,
        presets,
        connections: instance.connections,
        rows: now().rows,
        maxPivotRows: instance.limits.maxPivotRows,
        recent,
        onPivot: (action) => {
          record(recentPivotKey(action));
          const { rows, pivotRowIds, cell } = now();
          void pivotIntoAction({
            action,
            parentTabId,
            rows,
            cell,
            connections: instance.connections,
            pivotRowIds,
            notify,
            goTo,
            run,
          });
        },
        onPivotPreset: (preset, action, resolved) => {
          record(recentPivotKey(preset));
          const { rows, pivotRowIds } = now();
          pivotIntoPreset({
            preset,
            action,
            resolved,
            rows,
            pivotRowIds,
            parentTabId,
            notify,
            goTo,
            run,
          });
        },
      });
    },
    [instance, presets, recent, record, notify, navigate, parentTabId, run],
  );
}
