import type { CellFocusedEvent, CellKeyDownEvent } from 'ag-grid-community';
import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NotifyContext } from '../../components/notifyContext';
import { getAnnotationStore, pollAnnotationsSoon } from '../../lib/annotations';
import type { Annotations, InstanceLabel } from '../../lib/api';
import type { GetExtraContextMenuItems, GridRowWithId } from '../grid';
import type { LabelledRow } from '../labels';
import { buildHistoryMenu, makeHistoryKeys } from './annotateMenu';
import { HistoryPanel } from './HistoryPanel';

export interface HistoryPanelOptions {
  labels: readonly InstanceLabel[];
  /** The action takes its rows' id from an Id column param. */
  idParam: boolean;
}

export interface HistoryPanelState {
  /** History, for the grid's context menu. */
  menu: GetExtraContextMenuItems;
  /** H, for the grid's cell key handler. */
  keys: (e: CellKeyDownEvent<GridRowWithId>) => void;
  /** For the grid's cell focus handler: the open panel follows the focused row. */
  onCellFocused: (e: CellFocusedEvent<GridRowWithId>) => void;
  /** The open panel, if any, to render in the grid's container. */
  panel: ReactNode;
}

/**
 * History (H) on a grid's rows: the menu item, the key and the side panel. The panel follows the
 * focused row and takes the annotations of its `id` from the annotation store, so a change from
 * the feed updates it. A comment added from it goes into the store as the analyst's own.
 */
export function useHistoryPanel({ labels, idParam }: HistoryPanelOptions): HistoryPanelState {
  const notify = useContext(NotifyContext);
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<LabelledRow | null>(null);
  // The annotations last read from the store; the shown row's only when the ids match.
  const [stored, setStored] = useState<Annotations | null>(null);
  const id = row?.id ?? null;
  const annotations = stored !== null && stored.id === id ? stored : null;

  useEffect(() => {
    if (id === null) return;
    let live = true;
    const store = getAnnotationStore();
    void store.get([id]).then((found) => {
      const current = found.get(id);
      if (live && current) setStored(current);
    });
    const unsubscribe = store.subscribe(({ changes }) => {
      const change = changes.find((c) => c.id === id);
      if (change) setStored(change);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [id]);

  const options = useMemo(
    () => ({
      idParam,
      notify: (message: string) => notify?.(message),
      open: (target: LabelledRow) => {
        setRow(target);
        setOpen(true);
      },
    }),
    [idParam, notify],
  );
  const menu = useMemo(() => buildHistoryMenu(options), [options]);
  const keys = useMemo(() => makeHistoryKeys(options), [options]);
  const onCellFocused = useCallback(
    (e: CellFocusedEvent<GridRowWithId>) => {
      if (!open || e.rowIndex === null) return;
      const data = e.api.getDisplayedRowAtIndex(e.rowIndex)?.data;
      if (data) setRow(data);
    },
    [open],
  );
  const onCommented = useCallback(async (changes: Annotations[]) => {
    await getAnnotationStore().apply(changes, 'own');
    pollAnnotationsSoon();
  }, []);

  const panel = open && (
    <HistoryPanel
      row={row}
      annotations={annotations}
      labels={labels}
      onCommented={onCommented}
      onClose={() => setOpen(false)}
    />
  );
  return { menu, keys, onCellFocused, panel };
}
