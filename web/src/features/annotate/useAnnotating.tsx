import type { CellKeyDownEvent } from 'ag-grid-community';
import { useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { NotifyContext } from '../../components/notifyContext';
import { getAnnotationStore, pollAnnotationsSoon } from '../../lib/annotations';
import type { Annotations, InstanceLabel } from '../../lib/api';
import type { GetExtraContextMenuItems, GridRowWithId } from '../grid';
import { targetIds, type LabelledRow, type RowsById } from '../labels';
import { whyNoSink, type Sinks } from '../sinks';
import { AnnotateDialog } from './AnnotateDialog';
import { reachOf, savedMessage, type AnnotateMode, type Reach } from './annotateLogic';
import { buildAnnotateMenu, makeAnnotateKeys } from './annotateMenu';

export interface AnnotatingOptions {
  labels: readonly InstanceLabel[];
  /** `maxAnnotationIds`: the most distinct `id`s one change takes. */
  max: number;
  /** The action takes its rows' id from an Id column param. */
  idParam: boolean;
  /** The grid's rows of each `id`. */
  rowsById: RowsById;
  /** The sinks Annotate… offers to run on the rows after tagging. */
  sinks?: Sinks;
}

export interface Annotating {
  /** Annotate… and Comment…, for the grid's context menu. */
  menu: GetExtraContextMenuItems;
  /** T and C, for the grid's cell key handler. */
  keys: (e: CellKeyDownEvent<GridRowWithId>) => void;
  /** The open dialog, if any, to render beside the grid. */
  dialog: ReactNode;
}

/** The Annotate dialog, open for these targets. */
interface OpenDialog {
  mode: AnnotateMode;
  /** The rows it was opened on. */
  rows: LabelledRow[];
  targets: string[];
  reach: Reach;
  current: Annotations[];
}

/**
 * Annotate… (T) and Comment… (C) on a grid's rows: the menu items, the keys and the dialog. A saved
 * change goes into the annotation store as the analyst's own, then a toast says what changed, and
 * the sink picked in Annotate… starts on the rows.
 */
export function useAnnotating({
  labels,
  max,
  idParam,
  rowsById,
  sinks,
}: AnnotatingOptions): Annotating {
  const notify = useContext(NotifyContext);
  const [open, setOpen] = useState<OpenDialog | null>(null);
  const options = useMemo(
    () => ({
      max,
      idParam,
      notify: (message: string) => notify?.(message),
      open: (mode: AnnotateMode, rows: LabelledRow[]) => {
        const targets = targetIds(rows);
        void getAnnotationStore()
          .get(targets)
          .then((found) =>
            setOpen({
              mode,
              rows,
              targets,
              reach: reachOf(rows, rowsById),
              current: [...found.values()],
            }),
          );
      },
    }),
    [max, idParam, notify, rowsById],
  );
  const onSaved = useCallback(
    async (mode: AnnotateMode, changes: Annotations[]) => {
      await getAnnotationStore().apply(changes, 'own');
      pollAnnotationsSoon();
      notify?.(savedMessage(mode, changes.length));
    },
    [notify],
  );
  const menu = useMemo(() => buildAnnotateMenu(options), [options]);
  const keys = useMemo(() => makeAnnotateKeys(options), [options]);
  const dialog = open && (
    <AnnotateDialog
      mode={open.mode}
      targets={open.targets}
      reach={open.reach}
      current={open.current}
      labels={labels}
      afterTagging={
        sinks && {
          sinks: sinks.sinks,
          last: sinks.last,
          disabled: whyNoSink(open.rows.length, max),
          run: (sink) => sinks.run(sink, open.rows),
        }
      }
      onSaved={(changes) => onSaved(open.mode, changes)}
      onClose={() => setOpen(null)}
    />
  );
  return { menu, keys, dialog };
}
