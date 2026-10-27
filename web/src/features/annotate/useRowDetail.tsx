import type { CellFocusedEvent, CellKeyDownEvent } from 'ag-grid-community';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getAnnotationStore, pollAnnotationsSoon } from '../../lib/annotations';
import type { Annotations, InstanceLabel } from '../../lib/api';
import type { DetailColumns, GetExtraContextMenuItems, GridRowWithId } from '../grid';
import type { LabelledRow } from '../labels';
import { buildRowDetailMenu, makeRowDetailKeys } from './annotateMenu';
import { RowDetail } from './RowDetail';

const NO_COLUMNS: DetailColumns = [];

export interface RowDetailOptions {
  labels: readonly InstanceLabel[];
  /** The action takes its rows' id from an Id column param. */
  idParam: boolean;
  /** The run's columns: the order of the fields. */
  columns?: DetailColumns | null;
}

export interface RowDetailState {
  /** Row detail, for the grid's context menu. */
  menu: GetExtraContextMenuItems;
  /** For the grid's key handler: D opens the panel on the focused row, or closes it. */
  keys: (e: CellKeyDownEvent<GridRowWithId>) => void;
  /** For the grid's cell focus handler: the open panel follows the focused row. */
  onCellFocused: (e: CellFocusedEvent<GridRowWithId>) => void;
  /** The open panel, if any, to render in the grid's container. */
  panel: ReactNode;
  /** Opens the panel on `row`. */
  open: (row: LabelledRow) => void;
}

/**
 * Row detail (D) on a grid's rows: the menu item, the key and the side panel. The panel follows the
 * focused row and takes the annotations of its `id` from the annotation store, so a change from
 * the feed updates it. A comment added from it goes into the store as the analyst's own.
 */
export function useRowDetail({ labels, idParam, columns }: RowDetailOptions): RowDetailState {
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<LabelledRow | null>(null);
  // The annotations last read from the store; the shown row's only when the ids match. Until
  // the store answers for a new id, the row's own copy shows.
  const [stored, setStored] = useState<Annotations | null>(null);
  const id = row?.id ?? null;
  const annotations = stored !== null && stored.id === id ? stored : (row?.annotations ?? null);

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

  const openOn = useCallback((target: LabelledRow) => {
    setRow(target);
    setOpen(true);
  }, []);
  const menu = useMemo(() => buildRowDetailMenu(openOn), [openOn]);
  const keys = useMemo(
    () => makeRowDetailKeys((target) => (open ? setOpen(false) : openOn(target))),
    [open, openOn],
  );
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
    <RowDetail
      row={row}
      annotations={annotations}
      labels={labels}
      columns={columns ?? NO_COLUMNS}
      idParam={idParam}
      onCommented={onCommented}
      onClose={() => setOpen(false)}
    />
  );
  return { menu, keys, onCellFocused, panel, open: openOn };
}
