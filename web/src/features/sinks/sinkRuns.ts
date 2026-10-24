import type { Notify } from '../../components/notifyContext';
import { getRun, isApiError, startRun, type Run, type SinkInput } from '../../lib/api';
import { runPollDelay } from '../action-tab';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/** Waits the given milliseconds. */
type Sleep = (ms: number) => Promise<void>;

/**
 * What to toast when a run ends or fails to start, and whether sending the same rows again makes
 * sense.
 */
interface Ending {
  message: string;
  retry: boolean;
}

/**
 * `localStorage` key of the sink runs being followed: a JSON list of `{runId, name}`, so that a
 * reload can show how they ended.
 */
export const PENDING_SINK_RUNS_KEY = 'tim-pending-sink-runs';

export interface SinkRunOptions {
  notify: Notify;
  /** Waits between polls. */
  sleep?: Sleep;
  /** Keeps the pending runs; `localStorage` by default. */
  storage?: Storage;
}

/** The sink a run is of, by its catalogue key and name. */
export interface SinkRef {
  key: string;
  name: string;
}

interface PendingRun {
  runId: string;
  name: string;
}

function readPending(storage: Storage): PendingRun[] {
  try {
    const stored: unknown = JSON.parse(storage.getItem(PENDING_SINK_RUNS_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (p): p is PendingRun =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as PendingRun).runId === 'string' &&
        typeof (p as PendingRun).name === 'string',
    );
  } catch {
    return [];
  }
}

function writePending(storage: Storage, pending: PendingRun[]): void {
  try {
    storage.setItem(PENDING_SINK_RUNS_KEY, JSON.stringify(pending));
  } catch {
    // Followed still on this page; only a reload loses it.
  }
}

/** The runs this page is following. */
const following = new Set<string>();

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const rows = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'row' : 'rows'}`;

/** Polls the run until it ends, every second for ten seconds, then every three. */
async function untilEnded(first: Run, sleep: Sleep): Promise<Run> {
  let run = first;
  for (let n = 0; run.status === 'running'; n++) {
    await sleep(runPollDelay(n));
    run = await getRun(run.runId);
  }
  return run;
}

/** What an ended run did: how many rows it took, or why it took none. */
function endMessage(run: Run): string {
  switch (run.status) {
    case 'succeeded': {
      const taken = run.details?.inputRowCount;
      return typeof taken === 'number' ? rows(taken) : 'Done';
    }
    case 'error':
      return run.error || 'The run failed';
    case 'timedOut':
      return run.error || 'The run timed out';
    default:
      return 'The run was cancelled';
  }
}

/** Why a run could not start, and whether sending the same rows again might start it. */
function startError(e: unknown): Ending {
  if (isApiError(e) && e.status === 413) {
    return { message: 'Too much to send; select fewer rows', retry: false };
  }
  if (isApiError(e) && e.status === 422 && e.errors) {
    return { message: `Couldn't start: ${Object.values(e.errors).flat().join(' ')}`, retry: false };
  }
  return { message: `Couldn't start: ${reasonOf(e)}`, retry: !isApiError(e) || e.status !== 404 };
}

/**
 * How the run ended, or why it isn't known, and whether sending the rows again makes sense: not
 * once they are taken, nor when the run was lost track of, as it may have taken them.
 */
async function ending(runId: string, first: Run | null, sleep: Sleep): Promise<Ending> {
  try {
    const run = await untilEnded(first ?? (await getRun(runId)), sleep);
    return { message: endMessage(run), retry: run.status !== 'succeeded' };
  } catch (e) {
    if (isApiError(e) && e.status === 404) {
      return { message: 'The run is no longer available', retry: false };
    }
    return { message: `Lost track of the run: ${reasonOf(e)}`, retry: false };
  }
}

/**
 * Follows the run until it ends, kept in `storage` meanwhile, then toasts how it ended. A run that
 * ended without taking the rows gets `retry`, when there is one.
 */
async function followSink(
  runId: string,
  name: string,
  { notify, sleep = wait, storage = localStorage }: SinkRunOptions,
  { first = null, retry }: { first?: Run | null; retry?: () => void } = {},
): Promise<void> {
  following.add(runId);
  const pending = readPending(storage);
  if (!pending.some((p) => p.runId === runId)) writePending(storage, [...pending, { runId, name }]);
  const ended = await ending(runId, first, sleep);
  writePending(
    storage,
    readPending(storage).filter((p) => p.runId !== runId),
  );
  following.delete(runId);
  notify({
    message: `${name}: ${ended.message}`,
    ...(retry && ended.retry && { action: { label: 'Retry', onClick: retry } }),
  });
}

/**
 * Runs `sink` on `input` in the background and ends in a toast: how many rows it took, or why it
 * didn't, with Retry, which sends `input` again. Never rejects.
 */
export async function runSink(
  sink: SinkRef,
  input: SinkInput,
  options: SinkRunOptions,
): Promise<void> {
  const retry = () => void runSink(sink, input, options);
  let started: Run;
  try {
    started = await startRun(sink.key, {}, { input });
  } catch (e) {
    const { message, retry: retryable } = startError(e);
    options.notify({
      message: `${sink.name}: ${message}`,
      ...(retryable && { action: { label: 'Retry', onClick: retry } }),
    });
    return;
  }
  await followSink(started.runId, sink.name, options, { first: started, retry });
}

/**
 * Picks up, after a reload, the sink runs the page was following, and toasts how each ended,
 * without Retry, as their rows are gone. Resolves once they have all ended. Never rejects.
 */
export async function resumeSinkRuns(options: SinkRunOptions): Promise<void> {
  const { storage = localStorage } = options;
  const pending = readPending(storage).filter((p) => !following.has(p.runId));
  await Promise.all(pending.map(({ runId, name }) => followSink(runId, name, options)));
}
