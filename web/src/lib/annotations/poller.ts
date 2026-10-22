import type { AnnotationChangesPage } from '../api/annotations';
import { annotationSyncDao } from '../storage';
import type { AnnotationStore, AnnotationsMessage } from './annotationStore';

/** The Web Lock whose holder is the browser's one poller. */
export const POLLER_LOCK = 'tim-annotations-poller';

/** The part of `navigator.locks` the poller uses. */
export interface PollerLocks {
  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<unknown>,
  ): Promise<unknown>;
}

export interface AnnotationPollerOptions {
  store: AnnotationStore;
  locks: PollerLocks;
  intervalMs: number;
  fetchChanges: (since: number) => Promise<AnnotationChangesPage>;
  /** Polls when this fires `focus`: the window. */
  focus: EventTarget;
}

export interface AnnotationPoller {
  /** Reads the feed now, in whichever tab polls. */
  pollSoon(): void;
  /** Stops polling here, handing it to another tab. */
  stop(): void;
}

/**
 * Reads the change feed into `store` while this tab holds the poller lock: at once, every
 * `intervalMs`, on focus, and when any tab asks. The other tabs queue for the lock and hear the
 * changes through the store's channel.
 */
export function startAnnotationPoller({
  store,
  locks,
  intervalMs,
  fetchChanges,
  focus,
}: AnnotationPollerOptions): AnnotationPoller {
  const stopping = new AbortController();
  let leader = false;
  let polling = false;
  let again = false;

  async function readFeed(): Promise<void> {
    let cursor = await annotationSyncDao.getCursor();
    for (;;) {
      const page = await fetchChanges(cursor);
      await store.apply(page.changes, 'feed');
      cursor = page.next;
      await annotationSyncDao.putCursor(cursor);
      if (!page.hasMore || stopping.signal.aborted) return;
    }
  }

  async function poll(): Promise<void> {
    if (polling) {
      again = true;
      return;
    }
    polling = true;
    try {
      do {
        again = false;
        try {
          await readFeed();
        } catch {
          // Offline or the API is down: the next poll tries again.
        }
      } while (again && !stopping.signal.aborted);
    } finally {
      polling = false;
    }
  }

  const pollSoon = () => {
    if (stopping.signal.aborted) return;
    if (leader) void poll();
    else store.channel?.postMessage({ type: 'poll' });
  };
  const onMessage = (e: MessageEvent<AnnotationsMessage>) => {
    if (leader && e.data.type === 'poll') void poll();
  };
  store.channel?.addEventListener('message', onMessage);
  focus.addEventListener('focus', pollSoon);

  locks
    .request(POLLER_LOCK, { signal: stopping.signal }, async () => {
      leader = true;
      void poll();
      const timer = setInterval(() => void poll(), intervalMs);
      try {
        await new Promise((resolve) => stopping.signal.addEventListener('abort', resolve));
      } finally {
        clearInterval(timer);
        leader = false;
      }
    })
    .catch(() => {
      // Stopped while waiting for the lock.
    });

  return {
    pollSoon,
    stop() {
      stopping.abort();
      store.channel?.removeEventListener('message', onMessage);
      focus.removeEventListener('focus', pollSoon);
    },
  };
}
