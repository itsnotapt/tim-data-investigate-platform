import { getAnnotationStore } from '../../lib/annotations';
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
import { useTabsStore, type ParamErrors, type TabsStore } from '../tabs';
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

/** Stops the tab executing and shows `message` as its error. */
function showError(store: TabsStore, uuid: string, message: string): void {
  store.getState().updateState(uuid, { isExecuting: false, cancelling: false, error: { message } });
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
function startErrors(
  e: unknown,
  action: string,
  values: Record<string, unknown>,
): { paramErrors: ParamErrors | null; message: string | null } {
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
 * is shown in the tab's grid as it arrives, once its ids' annotations are in the annotation store.
 */
async function loadRows(uuid: string, run: Run, signal: AbortSignal): Promise<RunRow[]> {
  const rowCount = run.rowCount ?? 0;
  const shown = runRowsStore.getState();
  shown.start(uuid, run.runId, run.columns ?? null, rowCount);
  const rows: RunRow[] = [];
  while (rows.length < rowCount) {
    const page = await getRunRows(run.runId, rows.length, rowCount, { signal });
    if (page.rows.length === 0) break;
    await getAnnotationStore().apply(Object.values(page.annotations), 'rows');
    rows.push(...page.rows);
    shown.append(uuid, run.runId, page.rows);
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
  /** The run whose rows are being shown as they load; dropped unless they all load. */
  let loading: string | null = null;
  try {
    for (let n = 0; run.status === 'running'; n++) {
      await sleep(runPollDelay(n), signal);
      run = await getRun(run.runId, { signal });
      if (signal.aborted) return;
      update(run);
    }
    const message = endMessage(run);
    if (message !== null) return fail(message);
    loading = run.runId;
    const rows = await loadRows(uuid, run, signal);
    if (signal.aborted) return;
    await rowResultsDao.put(uuid, rows);
    runRowsStore.getState().finish(uuid, run.runId);
    store.getState().updateState(uuid, {
      isExecuting: false,
      cancelling: false,
      error: null,
      rowCount: rows.length,
      resultsRunId: run.runId,
      resultColumns: run.columns ?? null,
      resultsStartedAt: run.startedAt,
    });
    store.getState().markUnvisited(uuid);
    store.getState().triggerRowData(uuid);
    await store.getState().flush();
  } catch (e) {
    if (signal.aborted) return;
    if (isResultsGone(e)) return fail(RESULTS_GONE);
    if (isApiError(e) && e.status === 404) return fail(RUN_GONE);
    fail(reasonOf(e));
  } finally {
    const shown = runRowsStore.getState().byTab[uuid];
    if (shown && shown.runId === loading && !shown.done) runRowsStore.getState().drop(uuid);
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
  store.getState().updateState(uuid, {
    isExecuting: true,
    cancelling: false,
    error: null,
    paramErrors: null,
    run: null,
  });
  let run: Run;
  try {
    run = await startRun(tab.params.action, tab.params.params, { signal });
  } catch (e) {
    if (signal.aborted) return;
    following.delete(uuid);
    const { paramErrors, message } = startErrors(e, tab.params.action, tab.params.params);
    store.getState().updateState(uuid, {
      isExecuting: false,
      error: message === null ? null : { message },
      paramErrors,
      // Refused params alone leave the latest run as it was.
      run: message === null ? tab.state.run : null,
    });
    return;
  }
  if (signal.aborted) return;
  store.getState().updateState(uuid, { run, runParams: tab.params.params, pivotMissing: null });
  // Saved at once, so a reload picks the run up by its id.
  await store.getState().flush();
  await followRun(uuid, run, signal, options);
}

/**
 * Asks the server to cancel the tab's run. The tab shows it cancelling until it ends; when the
 * answer is that it has already ended, the tab shows so at once. Never rejects.
 */
export async function cancelActionTab(uuid: string, options: ActionRunOptions = {}): Promise<void> {
  const store = options.store ?? useTabsStore;
  const tab = store.getState().tabs[uuid];
  const runId = tab?.state.run?.status === 'running' ? tab.state.run.runId : null;
  if (tab?.componentName !== 'ActionResult' || !tab.state.isExecuting || runId === null) return;
  store.getState().updateState(uuid, { cancelling: true });
  let run: Run;
  try {
    run = await cancelRun(runId);
  } catch (e) {
    store.getState().updateState(uuid, {
      cancelling: false,
      error: { message: `Couldn't cancel: ${reasonOf(e)}` },
    });
    return;
  }
  const current = store.getState().tabs[uuid]?.state;
  // A succeeded run's rows are left to the poll that is following it.
  if (run.status === 'running' || run.status === 'succeeded') return;
  if (!current?.isExecuting || current.run?.runId !== runId) return;
  store.getState().updateState(uuid, { run });
  await followRun(uuid, run, follow(uuid), options);
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
