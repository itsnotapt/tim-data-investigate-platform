import { useCallback } from 'react';
import { useNotify } from '../../components/useNotify';
import type { TimeRange } from '../../lib/time-range';
import { runKustoQuery } from './runKustoQuery';

export interface RunKustoQueryArgs {
  uuid: string;
  timeRange: TimeRange;
}

/** Shows "Executing query..." and runs the tab's query (`runKustoQuery`). */
export function useRunKustoQuery(): (args: RunKustoQueryArgs) => void {
  const notify = useNotify();
  return useCallback(
    ({ uuid, timeRange }) => {
      notify('Executing query...');
      void runKustoQuery(uuid, timeRange);
    },
    [notify],
  );
}
