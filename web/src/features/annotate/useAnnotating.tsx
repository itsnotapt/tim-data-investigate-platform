import { useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { NotifyContext } from '../../components/notifyContext';
import { getAnnotationStore, pollAnnotationsSoon } from '../../lib/annotations';
import type { Annotations, InstanceLabel } from '../../lib/api';
import { useAnalyst } from '../analyst';
import type { RowsKeys, RowsMenu } from '../grid';
import { targetIds, whyUnlabellable, type RowsOf } from '../labels';
import { whyNoSink, type Sinks } from '../sinks';
import { AnnotateDialog } from './AnnotateDialog';
import { reachOf, savedMessage, type AnnotateMode, type Reach } from './annotateLogic';
import { buildAnnotateMenu, makeAnnotateKeys } from './annotateMenu';

export interface AnnotatingOptions {
  labels: readonly InstanceLabel[];
  /** `maxAnnotationIds`: the most distinct `id`s one change takes. */
  max: number;
  /** Why a row has no `id`, from `noIdReason`. */
  noId: string;
  /** The rows of the tab's Results, as they are now. */
  rowsOf: RowsOf;
  /** The sinks Annotate… offers to run on the rows after tagging. */
  sinks?: Sinks;
}

export interface Annotating {
  /** Annotate… and Comment…, for the grid's context menu. */
  menu: RowsMenu;
  /** T and C, for the grid's cell key handler. */
  keys: RowsKeys;
  /** The open dialog, if any, to render beside the grid. */
  dialog: ReactNode;
}

/** The Annotate dialog, open for these targets. */
interface OpenDialog {
  mode: AnnotateMode;
  /** The rows it was opened on. */
  rows: ReturnType<RowsOf>;
  targets: string[];
  reach: Reach;
  current: Annotations[];
}

/**
 * Annotate… (T) and Comment… (C) on a grid's rows: the menu items, the keys and the dialog. A saved
 * change goes into the annotation store as the analyst's own, then a toast says what changed, and
 * the sink picked in Annotate… starts on the rows.
 */
export function useAnnotating({ labels, max, noId, rowsOf, sinks }: AnnotatingOptions): Annotating {
  const notify = useContext(NotifyContext);
  const analyst = useAnalyst();
  const [open, setOpen] = useState<OpenDialog | null>(null);
  const options = useMemo(
    () => ({
      max,
      noId,
      rowsOf,
      notify: (message: string) => notify?.(message),
      // The dialog opens on the `id`s the rows have when it opens.
      open: (mode: AnnotateMode, rowNumbers: readonly number[]) => {
        const rows = rowsOf(rowNumbers);
        const targets = targetIds(rows);
        const reason = whyUnlabellable(targets, max, noId);
        if (reason !== null) return void notify?.(reason);
        void getAnnotationStore()
          .get(targets)
          .then((found) =>
            setOpen({
              mode,
              rows,
              targets,
              reach: reachOf(rows),
              current: [...found.values()],
            }),
          );
      },
    }),
    [max, noId, notify, rowsOf],
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
      analyst={analyst}
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
