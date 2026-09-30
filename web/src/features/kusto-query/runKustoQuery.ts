import type { TimeRange } from '../../lib/time-range';
import { useTabsStore } from '../tabs';
import { runTabQuery, type RunPipelineOptions } from './runPipeline';

export type RunKustoQueryOptions = RunPipelineOptions;

/**
 * Runs a Kusto tab's saved query with the given (or the tab's stored) time range via the shared
 * pipeline (`runTabQuery`). Never rejects.
 */
export async function runKustoQuery(
  uuid: string,
  timeRange?: TimeRange,
  options: RunKustoQueryOptions = {},
): Promise<void> {
  const store = options.store ?? useTabsStore;
  const tab = store.getState().tabs[uuid];
  if (tab?.componentName !== 'KustoQueryResult') return;
  const { cluster, database, query } = tab.params;
  await runTabQuery(
    uuid,
    { cluster, database, query, timeRange: timeRange ?? tab.state.timeRange },
    options,
  );
}
