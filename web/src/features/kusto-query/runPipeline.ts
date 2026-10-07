import { runQuery, type KustoQueryStats } from '../../lib/api';
import { rowResultsDao } from '../../lib/storage';
import { resolveTimeRange, type TimeRange } from '../../lib/time-range';
import { useTabsStore, type TabsStore } from '../tabs';

export interface RunPipelineOptions {
  store?: TabsStore;
  /** Extra cancel signal (the run is always aborted when the tab is removed). */
  signal?: AbortSignal;
}

export interface PipelineQuery {
  cluster: string;
  database: string;
  query: string;
  /** Omitted for template queries. */
  timeRange?: TimeRange;
}

/** One run per tab: a new run aborts the previous one. */
const active = new Map<string, AbortController>();

function statsToState(stats: KustoQueryStats | null) {
  const usage = stats?.resource_usage as
    { cpu?: Record<string, unknown>; memory?: Record<string, unknown> } | null | undefined;
  const str = (v: unknown): string | null =>
    typeof v === 'string' || typeof v === 'number' ? String(v) : null;
  return {
    executionTime: stats?.execution_time ?? null,
    cpuUsage: str(usage?.cpu?.['total cpu']),
    memoryUsage: str(usage?.memory?.peak_per_node),
  };
}

/**
 * Shared run pipeline for Kusto and template tabs: sets
 * executing, calls the API with the resolved time range (if any), stores rows (IndexedDB) and
 * stats, marks the tab unvisited and triggers the grid. Errors are stored as `{message, code?}`
 * and the rows deleted. Aborted when the tab is removed; nothing is
 * written after that. One run per tab: a new run aborts the previous one. Never rejects.
 */
export async function runTabQuery(
  uuid: string,
  { cluster, database, query, timeRange: range }: PipelineQuery,
  { store = useTabsStore, signal }: RunPipelineOptions = {},
): Promise<void> {
  active.get(uuid)?.abort();
  const controller = new AbortController();
  active.set(uuid, controller);
  const onOuterAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  signal?.addEventListener('abort', onOuterAbort, { once: true });
  const unsubscribe = store.subscribe((s) => {
    if (!s.tabs[uuid]) controller.abort();
  });

  store.getState().updateState(uuid, { isExecuting: true, isVisited: false, error: null });

  const alive = () => !controller.signal.aborted && store.getState().tabs[uuid] !== undefined;
  try {
    const resolved = range ? resolveTimeRange(range) : undefined;
    const { rows, stats } = await runQuery(
      {
        cluster,
        database,
        query,
        ...(resolved && {
          startTime: resolved.start.toISOString(),
          endTime: resolved.end.toISOString(),
        }),
      },
      { signal: controller.signal },
    );
    if (!alive()) return;
    await rowResultsDao.put(uuid, rows);
    if (!alive()) {
      await rowResultsDao.delete(uuid).catch(() => undefined);
      return;
    }
    store.getState().updateState(uuid, {
      isExecuting: false,
      rowCount: rows.length,
      ...statsToState(stats),
    });
    store.getState().triggerRowData(uuid);
  } catch (e) {
    if (!alive()) return;
    store.getState().updateState(uuid, { isExecuting: false, error: e });
    await rowResultsDao.delete(uuid).catch(() => undefined);
    if (alive()) store.getState().triggerRowData(uuid);
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', onOuterAbort);
    if (active.get(uuid) === controller) active.delete(uuid);
  }
}
