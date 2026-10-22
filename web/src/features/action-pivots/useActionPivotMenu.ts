import type { GetContextMenuItemsParams, IRowNode } from 'ag-grid-community';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useNotify } from '../../components/useNotify';
import type { RunRow } from '../../lib/api';
import type { GetExtraContextMenuItems } from '../grid';
import { useInstanceStore } from '../instance';
import { buildActionPivotMenu } from './actionPivotMenu';
import { pivotIntoAction } from './pivotIntoAction';
import { useRecentPivots } from './recentPivots';

/**
 * The targets of a context menu: the selected rows. Right-clicking a row outside them selects
 * just that row.
 */
function menuTargets({ api, node }: GetContextMenuItemsParams): IRowNode[] {
  if (node && !node.isSelected()) {
    api.deselectAll();
    node.setSelected(true);
  }
  const selected = api.getSelectedNodes();
  return selected.length > 0 ? selected : node ? [node] : [];
}

const values = (node: IRowNode) => (node.data as RunRow | undefined)?.data ?? {};

/**
 * `getContextMenuItems` provider for the grid of the action tab `parentUuid`: Pivot ▸ into the
 * actions. `run` runs a child tab that needs nothing.
 */
export function useActionPivotMenu(
  parentUuid: string,
  run: (uuid: string) => void,
): GetExtraContextMenuItems {
  const instance = useInstanceStore((s) => s.instance);
  const recent = useRecentPivots((s) => s.keys);
  const record = useRecentPivots((s) => s.record);
  const notify = useNotify();
  const navigate = useNavigate();
  return useMemo(
    () => (params) => {
      if (!instance) return [];
      const rows = menuTargets(params).map(values);
      const column = params.column?.getColId();
      const clicked = params.node ? values(params.node) : {};
      return buildActionPivotMenu({
        actions: instance.actions,
        rows,
        maxPivotRows: instance.limits.maxPivotRows,
        recent,
        onPivot: (action) => {
          record(action.key);
          void pivotIntoAction({
            action,
            parentUuid,
            rows,
            cell: column && column in clicked ? { column, value: clicked[column] } : null,
            connections: instance.connections,
            notify,
            goTo: (uuid) => void navigate(`/view/${uuid}`),
            run,
          });
        },
      });
    },
    [instance, recent, record, notify, navigate, parentUuid, run],
  );
}
