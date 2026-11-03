import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getAnnotationStore, pollAnnotationsSoon } from '../../lib/annotations';
import type { Annotations, InstanceLabel } from '../../lib/api';
import { useAnalyst } from '../analyst';
import type { DetailColumns, RowsKeys, RowsMenu } from '../grid';
import type { RowsOf } from '../labels';
import { buildRowDetailMenu, makeRowDetailKeys } from './annotateMenu';
import { RowDetail } from './RowDetail';

const NO_COLUMNS: DetailColumns = [];

export interface RowDetailOptions {
  labels: readonly InstanceLabel[];
  /** The run's columns: the order of the fields. */
  columns?: DetailColumns | null;
  /** The rows of the tab's Results, as they are now: the panel shows its row as they have it. */
  rowsOf: RowsOf;
}

export interface RowDetailState {
  /** Row detail, for the grid's context menu. */
  menu: RowsMenu;
  /** For the grid's key handler: D opens the panel on the focused row, or closes it. */
  keys: RowsKeys;
  /** For the grid's cell focus handler, with the focused row: the open panel follows it. */
  onRowFocused: (row: number) => void;
  /** The open panel, if any, to render in the grid's container. */
  panel: ReactNode;
  /** Opens the panel on the row with this row number. */
  open: (row: number) => void;
}

/**
 * Row detail (D) on a grid's rows: the menu item, the key and the side panel. The panel follows the
 * focused row, shows the row as the tab's Results have it now, and takes the annotations of its `id` from the annotation store, so a change from
 * the feed updates it. A comment saved from it goes into the store as the analyst's own.
 */
export function useRowDetail({ labels, columns, rowsOf }: RowDetailOptions): RowDetailState {
  const analyst = useAnalyst();
  // The row number of the row the panel shows; null while it's closed.
  const [shown, setShown] = useState<number | null>(null);
  const row = shown === null ? null : (rowsOf([shown])[0] ?? null);
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

  // Updates from the current row, not a captured one: the grid can call its handlers before it
  // has the ones from the latest render.
  const close = useCallback(() => setShown(null), []);
  const menu = useMemo(() => buildRowDetailMenu(setShown), []);
  const keys = useMemo(
    () => makeRowDetailKeys((target) => setShown((current) => (current === null ? target : null))),
    [],
  );
  const onRowFocused = useCallback((focused: number) => {
    setShown((current) => (current === null ? null : focused));
  }, []);
  const onCommented = useCallback(async (changes: Annotations[]) => {
    await getAnnotationStore().apply(changes, 'own');
    pollAnnotationsSoon();
  }, []);

  const panel = row !== null && (
    <RowDetail
      row={row}
      annotations={annotations}
      labels={labels}
      columns={columns ?? NO_COLUMNS}
      analyst={analyst}
      onCommented={onCommented}
      onClose={close}
    />
  );
  return { menu, keys, onRowFocused, panel, open: setShown };
}
