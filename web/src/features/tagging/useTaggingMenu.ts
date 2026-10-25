import { useContext, useMemo } from 'react';
import type { OpenTagDialog } from './TagDialogContext';
import { TagDialogContext } from './TagDialogContext';
import type { MenuItemDef } from 'ag-grid-community';
import type { CallOptions } from '../../lib/api';
import { NotifyContext } from '../../components/notifyContext';
import { applyRowUpdates } from '../grid/rowUpdates';
import type { GetExtraContextMenuItems, GridRowWithId } from '../grid';
import { canTag, DETERMINATION_CHOICES } from './tagDialogLogic';
import { quickTag } from './quickTag';

/** Structural slice of the ag-grid menu params we use, so tests can fake it. */
export interface TagMenuParams {
  node: { data?: unknown } | null;
  api: {
    getSelectedNodes(): { data?: unknown }[];
    applyTransaction(tx: { update: GridRowWithId[] }): unknown;
    deselectAll(): void;
  };
}

/** Selected rows, or the clicked row when nothing is selected. */
function tagTargets(params: TagMenuParams): GridRowWithId[] {
  const selected = params.api
    .getSelectedNodes()
    .map((n) => n.data as GridRowWithId | undefined)
    .filter((d): d is GridRowWithId => d !== undefined);
  if (selected.length > 0) return selected;
  return params.node?.data ? [params.node.data as GridRowWithId] : [];
}

export interface TaggingMenuOptions {
  notify: (message: string) => void;
  call?: CallOptions;
  /** Opens the customise dialog (`TagDialogContext`); the item is disabled without it. */
  openDialog?: OpenTagDialog | null;
}

/** "Tag Events" submenu with the three quick tags; disabled unless rows are taggable. */
export function buildTaggingMenu(uuid: string, opts: TaggingMenuOptions): GetExtraContextMenuItems {
  return (params) => {
    const p = params as unknown as TagMenuParams;
    const disabled = !canTag(tagTargets(p));
    const items: MenuItemDef[] = DETERMINATION_CHOICES.map((d) => ({
      name: `Quick - ${d}`,
      disabled,
      action: () => {
        const rows = tagTargets(p);
        void (async () => {
          const result = await quickTag(rows, d, opts.notify, opts.call);
          if (!result.ok) return;
          // Rows keep their client `_id`; the update replaces the grid row with the tagged copy.
          await applyRowUpdates(p.api, uuid, result.rows as GridRowWithId[]);
          p.api.deselectAll();
        })();
      },
    }));
    const customise: MenuItemDef = {
      name: 'Customise tag events',
      disabled: disabled || !opts.openDialog,
      action: () => opts.openDialog?.({ rows: tagTargets(p), api: p.api, uuid }),
    };
    return [{ name: 'Tag Events', disabled, subMenu: [customise, ...items] }];
  };
}

/** Tagging group for `ResultsGrid.getContextMenuItems` (first group, before "Show details"). */
export function useTaggingMenu(uuid: string, call?: CallOptions): GetExtraContextMenuItems {
  const notifyCtx = useContext(NotifyContext);
  const openDialog = useContext(TagDialogContext);
  return useMemo(
    () =>
      buildTaggingMenu(uuid, {
        notify: (message) => notifyCtx?.(message),
        call,
        openDialog,
      }),
    [uuid, notifyCtx, call, openDialog],
  );
}
