import {
  getRun,
  getRunRows,
  isApiError,
  isResultsGone,
  startRun,
  type Run,
  type RunRow,
} from '../../lib/api';
import { rowResultsDao } from '../../lib/storage';
import { useTabsStore, type TabsStore } from '../tabs';

const FAST_POLL_MS = 1000;
const FAST_POLLS = 10;
const SLOW_POLL_MS = 3000;

const RESULTS_GONE = 'Results are no longer available; run again';
const RUN_GONE = 'The run is no longer available; run again';

export interface ActionRunOptions {
  store?: TabsStore;
  /** Waits between polls; rejects when `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Delay before poll number `n` (0-based): every second for ten seconds, then every three. */
export function runPollDelay(n: number): number {
  return n < FAST_POLLS ? FAST_POLL_MS : SLOW_POLL_MS;
}

function abortSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason as Error);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason as Error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Stops the tab executing and shows `message` as its error. */
function showError(store: TabsStore, uuid: string, message: string): void {
  store.getState().updateState(uuid, { isExecuting: false, error: { message } });
}

/** The tab each run is followed for; a new run of the tab stops following the old one. */
const following = new Map<string, AbortController>();

function follow(uuid: string): AbortSignal {
  following.get(uuid)?.abort();
  const controller = new AbortController();
  following.set(uuid, controller);
  return controller.signal;
}

function endMessage(run: Run): string | null {
  switch (run.status) {
    case 'error':
      return run.error || 'The run failed';
    case 'timedOut':
      return run.error || 'The run timed out';
    case 'cancelled':
      return 'The run was cancelled';
    default:
      return null;
  }
}

/** A start error's message, with each invalid param's reasons (`params.<name>`). */
function startMessage(e: unknown): string {
  if (isApiError(e) && e.errors && Object.keys(e.errors).length > 0) {
    const reasons = Object.entries(e.errors).map(
      ([key, messages]) => `${key.replace(/^params\./, '')}: ${messages.join(' ')}`,
    );
    return `Couldn't start: ${reasons.join('; ')}`;
  }
  return `Couldn't start: ${e instanceof Error ? e.message : String(e)}`;
}

/** Every row of a succeeded run, page by page: the server returns at most its page size. */
async function loadRows(run: Run, signal: AbortSignal): Promise<RunRow[]> {
  const rowCount = run.rowCount ?? 0;
  const rows: RunRow[] = [];
  while (rows.length < rowCount) {
    const page = await getRunRows(run.runId, rows.length, rowCount, { signal });
    if (page.rows.length === 0) break;
    rows.push(...page.rows);
  }
  return rows;
}

/**
 * Follows the tab's run until it ends, then stores its rows in `row_results`. Polls every second
 * for ten seconds, then every three. Never rejects.
 */
async function followRun(
  uuid: string,
  first: Run,
  signal: AbortSignal,
  { store = useTabsStore, sleep = abortSleep }: ActionRunOptions,
): Promise<void> {
  const tabs = store.getState();
  const update = (run: Run) => tabs.updateState(uuid, { run });
  const fail = (message: string) => showError(store, uuid, message);
  let run = first;
  try {
    for (let n = 0; run.status === 'running'; n++) {
      await sleep(runPollDelay(n), signal);
      run = await getRun(run.runId, { signal });
      if (signal.aborted) return;
      update(run);
    }
    const message = endMessage(run);
    if (message !== null) return fail(message);
    const rows = await loadRows(run, signal);
    if (signal.aborted) return;
    await rowResultsDao.put(uuid, rows);
    store.getState().updateState(uuid, {
      isExecuting: false,
      error: null,
      rowCount: rows.length,
      resultsRunId: run.runId,
      resultColumns: run.columns ?? null,
    });
    store.getState().markUnvisited(uuid);
    store.getState().triggerRowData(uuid);
    await store.getState().flush();
  } catch (e) {
    if (signal.aborted) return;
    if (isResultsGone(e)) return fail(RESULTS_GONE);
    if (isApiError(e) && e.status === 404) return fail(RUN_GONE);
    fail(e instanceof Error ? e.message : String(e));
  } finally {
    if (following.get(uuid)?.signal === signal) following.delete(uuid);
  }
}

/**
 * Runs an action tab from its plain params, never re-resolving them, and follows the run until
 * its rows are stored. Never rejects.
 */
export async function runActionTab(uuid: string, options: ActionRunOptions = {}): Promise<void> {
  const store = options.store ?? useTabsStore;
  const tab = store.getState().tabs[uuid];
  if (tab?.componentName !== 'ActionResult') return;
  const signal = follow(uuid);
  store.getState().updateState(uuid, { isExecuting: true, error: null });
  let run: Run;
  try {
    run = await startRun(tab.params.action, tab.params.params, { signal });
  } catch (e) {
    if (signal.aborted) return;
    following.delete(uuid);
    showError(store, uuid, startMessage(e));
    return;
  }
  if (signal.aborted) return;
  store.getState().updateState(uuid, { run });
  // Saved at once, so a reload picks the run up by its id.
  await store.getState().flush();
  await followRun(uuid, run, signal, options);
}

/**
 * Picks up, after a reload, the runs action tabs were following: a run still running, or a
 * succeeded run whose rows were not stored yet. A tab left executing with nothing to follow (the
 * reload came before its run had an id) stops executing. Resolves once the runs are all followed
 * to the end.
 */
export async function resumeActionRuns(options: ActionRunOptions = {}): Promise<void> {
  const store = options.store ?? useTabsStore;
  const pending = Object.values(store.getState().tabs).flatMap((tab) => {
    if (tab.componentName !== 'ActionResult' || following.has(tab.componentUuid)) return [];
    const run = tab.state.run;
    const unfinished =
      run?.status === 'running' ||
      (run?.status === 'succeeded' && tab.state.resultsRunId !== run.runId);
    if (!run || !unfinished) {
      if (tab.state.isExecuting)
        store.getState().updateState(tab.componentUuid, { isExecuting: false });
      return [];
    }
    store.getState().updateState(tab.componentUuid, { isExecuting: true });
    return [followRun(tab.componentUuid, run, follow(tab.componentUuid), options)];
  });
  await Promise.all(pending);
}
