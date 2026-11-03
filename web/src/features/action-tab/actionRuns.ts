import {
  cancelRun,
  getRun,
  getRunRows,
  isApiError,
  isResultsGone,
  startRun,
  type Run,
  type RunRow,
} from '../../lib/api';
import { rowResultsDao } from '../../lib/storage';
import { useInstanceStore } from '../instance';
import type { ParamErrors } from '../../lib/storage';
import { useTabsStore, type TabsStore } from '../tabs';
import {
  cancelFailed,
  cancelRequested,
  fromShareLink,
  resumed,
  runFailed,
  runRefused,
  runStarted,
  runStarting,
  runSucceeded,
  runUpdated,
  stalled,
  type Refusal,
} from './model';
import { pills } from './queryParameters';
import { runRowsStore } from './runRows';

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

/** The tab each run is followed for; a new run of the tab stops following the old one. */
const following = new Map<string, AbortController>();

function follow(tabId: string): AbortSignal {
  following.get(tabId)?.abort();
  const controller = new AbortController();
  following.set(tabId, controller);
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

/** What was thrown, as a message. */
function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const PARAM_KEY = /^params\.(.+)$/;

/**
 * Why a run of `action` with `values` could not start: the reasons of each invalid param the tab
 * shows, in a pill or the editor (`params.<name>`, a query parameter's `params.parameters.<name>`),
 * and a message for any other reason, or `null` when there is none.
 */
function startErrors(e: unknown, action: string, values: Record<string, unknown>): Refusal {
  if (!isApiError(e) || !e.errors || Object.keys(e.errors).length === 0) {
    return { paramErrors: null, message: `Couldn't start: ${reasonOf(e)}` };
  }
  const params = useInstanceStore
    .getState()
    .instance?.actions.find((a) => a.key === action)?.params;
  const shown = new Set(pills(params ?? [], values).params.map((p) => p.name));
  const paramErrors: ParamErrors = {};
  const others: string[] = [];
  for (const [key, reasons] of Object.entries(e.errors)) {
    const name = PARAM_KEY.exec(key)?.[1];
    if (name === undefined) others.push(reasons.join(' '));
    else if (shown.has(name)) paramErrors[name] = reasons.join(' ');
    else others.push(`${name}: ${reasons.join(' ')}`);
  }
  return {
    paramErrors: Object.keys(paramErrors).length > 0 ? paramErrors : null,
    message: others.length > 0 ? `Couldn't start: ${others.join('; ')}` : null,
  };
}

/**
 * Every row of a succeeded run, page by page (the server returns at most its page size). Each page
 * is shown in the tab's grid as it arrives.
 */
async function loadRows(tabId: string, run: Run, signal: AbortSignal): Promise<RunRow[]> {
  const rowCount = run.rowCount ?? 0;
  const shown = runRowsStore.getState();
  shown.start(tabId, run.runId, run.columns ?? null, rowCount);
  const rows: RunRow[] = [];
  while (rows.length < rowCount) {
    const page = await getRunRows(run.runId, rows.length, rowCount, { signal });
    if (page.rows.length === 0) break;
    rows.push(...page.rows);
    shown.append(tabId, run.runId, page.rows);
  }
  return rows;
}

/**
 * Follows the tab's run until it ends, then stores its rows in `row_results`. Polls every second
 * for ten seconds, then every three. A linked row the stored rows don't have is dropped. Never
 * rejects.
 */
async function followRun(
  tabId: string,
  first: Run,
  signal: AbortSignal,
  { store = useTabsStore, sleep = abortSleep }: ActionRunOptions,
): Promise<void> {
  const fail = (message: string) => store.getState().apply(tabId, runFailed(message));
  let run = first;
  /** The run whose rows are being shown as they load; dropped unless they all load. */
  let loading: string | null = null;
  try {
    for (let n = 0; run.status === 'running'; n++) {
      await sleep(runPollDelay(n), signal);
      run = await getRun(run.runId, { signal });
      if (signal.aborted) return;
      store.getState().apply(tabId, runUpdated(run));
    }
    const message = endMessage(run);
    if (message !== null) return fail(message);
    loading = run.runId;
    const rows = await loadRows(tabId, run, signal);
    if (signal.aborted) return;
    await rowResultsDao.put(tabId, rows);
    runRowsStore.getState().finish(tabId, run.runId);
    store.getState().apply(tabId, runSucceeded(run, rows));
    store.getState().markUnvisited(tabId);
    store.getState().triggerRowData(tabId);
    await store.getState().flush();
  } catch (e) {
    if (signal.aborted) return;
    if (isResultsGone(e)) return fail(RESULTS_GONE);
    if (isApiError(e) && e.status === 404) return fail(RUN_GONE);
    fail(reasonOf(e));
  } finally {
    const shown = runRowsStore.getState().byTab[tabId];
    if (shown && shown.runId === loading && !shown.done) runRowsStore.getState().drop(tabId);
    if (following.get(tabId)?.signal === signal) following.delete(tabId);
  }
}

/**
 * Runs an action tab from its plain params, never re-resolving them, and follows the run until
 * its rows are stored. Never rejects.
 */
export async function runActionTab(tabId: string, options: ActionRunOptions = {}): Promise<void> {
  const store = options.store ?? useTabsStore;
  const tab = store.getState().tabs[tabId];
  if (!tab) return;
  const { action, params, pivotRows } = tab.toRun;
  const signal = follow(tabId);
  store.getState().apply(tabId, runStarting);
  let run: Run;
  try {
    run = await startRun(action, params, { signal, pivotRows });
  } catch (e) {
    if (signal.aborted) return;
    following.delete(tabId);
    store.getState().apply(tabId, runRefused(startErrors(e, action, params), tab));
    return;
  }
  if (signal.aborted) return;
  store.getState().apply(tabId, runStarted(run, { params, pivotRows }));
  // Saved at once, so a reload picks the run up by its id.
  await store.getState().flush();
  await followRun(tabId, run, signal, options);
}

/**
 * Asks the server to cancel the tab's run. The tab shows it cancelling until it ends; when the
 * answer is that it has already ended, the tab shows so at once. Never rejects.
 */
export async function cancelActionTab(
  tabId: string,
  options: ActionRunOptions = {},
): Promise<void> {
  const store = options.store ?? useTabsStore;
  const tab = store.getState().tabs[tabId];
  const runId = tab?.latest.run?.status === 'running' ? tab.latest.run.runId : null;
  if (!tab?.status.executing || runId === null) return;
  store.getState().apply(tabId, cancelRequested);
  let run: Run;
  try {
    run = await cancelRun(runId);
  } catch (e) {
    store.getState().apply(tabId, cancelFailed(`Couldn't cancel: ${reasonOf(e)}`));
    return;
  }
  const current = store.getState().tabs[tabId];
  // A succeeded run's rows are left to the poll that is following it.
  if (run.status === 'running' || run.status === 'succeeded') return;
  if (!current?.status.executing || current.latest.run?.runId !== runId) return;
  store.getState().apply(tabId, runUpdated(run));
  await followRun(tabId, run, follow(tabId), options);
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
    if (following.has(tab.id)) return [];
    const run = tab.latest.run;
    const unfinished =
      run?.status === 'running' ||
      (run?.status === 'succeeded' && tab.results?.runId !== run.runId);
    if (!run || !unfinished) {
      if (tab.status.executing) store.getState().apply(tab.id, stalled);
      return [];
    }
    store.getState().apply(tab.id, resumed);
    return [followRun(tab.id, run, follow(tab.id), options)];
  });
  await Promise.all(pending);
}

/**
 * Opens `run` in a new root action tab, as a share link does: the tab holds the run's action and
 * params, `linkedRow` when the link names a row, and `idColumn` when it names an Id column. Starts no
 * run; follows `run` until its rows are stored. Returns the tab's id.
 */
export function openRunTab(
  run: Run,
  linkedRow: number | null,
  idColumn: string | null = null,
  options: ActionRunOptions = {},
): string {
  const store = options.store ?? useTabsStore;
  const tabId = store.getState().createTab({
    parentId: null,
    content: fromShareLink(run, linkedRow, idColumn),
  });
  void followRun(tabId, run, follow(tabId), options);
  return tabId;
}
