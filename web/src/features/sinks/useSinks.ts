import { useContext, useMemo } from 'react';
import { NotifyContext } from '../../components/notifyContext';
import type { CatalogueAction, RunColumn, RunRow } from '../../lib/api';
import type { GridRow } from '../grid/columns';
import { useInstanceStore } from '../instance';
import { useLastSink } from './lastSink';
import { runSink } from './sinkRuns';

const NO_ACTIONS: readonly CatalogueAction[] = [];

export interface Sinks {
  /** The installed sinks. */
  sinks: readonly CatalogueAction[];
  /** The key of the last sink run. */
  last: string | null;
  /**
   * Starts `sink` in the background on an action grid's `rows`, every column of each, and keeps it
   * as the last sink run.
   */
  run: (sink: CatalogueAction, rows: readonly GridRow[]) => void;
}

/** The installed sinks, run on rows with `columns`: the columns of the run they came from. */
export function useSinks(columns: readonly RunColumn[] | null | undefined): Sinks {
  const actions = useInstanceStore((s) => s.instance?.actions) ?? NO_ACTIONS;
  const last = useLastSink((s) => s.key);
  const record = useLastSink((s) => s.record);
  const notify = useContext(NotifyContext);
  const sinks = useMemo(() => actions.filter((a) => a.kind === 'sink'), [actions]);
  const run = useMemo(() => {
    const input = (columns ?? []).map(({ name, type }) => ({ name, type }));
    return (sink: CatalogueAction, rows: readonly GridRow[]) => {
      record(sink.key);
      // An action grid's row is a run's row: its `data` is the row as the run gave it.
      const data = rows.map((r) => (r as Partial<RunRow>).data ?? {});
      void runSink(
        sink,
        { columns: input, rows: data },
        { notify: (options) => notify?.(options) },
      );
    };
  }, [columns, record, notify]);
  return useMemo(() => ({ sinks, last, run }), [sinks, last, run]);
}
