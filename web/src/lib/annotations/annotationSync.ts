import { getAnnotationChanges } from '../api/annotations';
import {
  ANNOTATIONS_CHANNEL,
  createAnnotationStore,
  type AnnotationStore,
} from './annotationStore';
import { startAnnotationPoller, type AnnotationPoller, type PollerLocks } from './poller';

let store: AnnotationStore | null = null;
let poller: AnnotationPoller | null = null;

/** The browser's annotations, shared with the other tabs. */
export function getAnnotationStore(): AnnotationStore {
  store ??= createAnnotationStore(
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(ANNOTATIONS_CHANNEL),
  );
  return store;
}

/** Without Web Locks every tab polls. */
const everyTab: PollerLocks = { request: (_name, _options, callback) => callback() };

/** Starts this tab's poller, polling every `intervalSeconds`; returns the stop. */
export function startAnnotationSync(intervalSeconds: number): () => void {
  poller?.stop();
  const started = startAnnotationPoller({
    store: getAnnotationStore(),
    locks: typeof navigator.locks === 'undefined' ? everyTab : navigator.locks,
    intervalMs: intervalSeconds * 1000,
    fetchChanges: (since) => getAnnotationChanges(since),
    focus: window,
  });
  poller = started;
  return () => {
    started.stop();
    if (poller === started) poller = null;
  };
}

/** Reads the feed now, after the analyst's own changes. */
export function pollAnnotationsSoon(): void {
  poller?.pollSoon();
}
