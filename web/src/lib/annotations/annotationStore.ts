import type { Annotations } from '../api/annotations';
import { annotationsDao } from '../storage';

/** Where applied annotations came from: the analyst's own change in this browser, or the change feed. */
export type AnnotationsSource = 'own' | 'feed';

export interface AnnotationsApplied {
  changes: Annotations[];
  source: AnnotationsSource;
}

/** What tabs of one browser tell each other. */
export type AnnotationsMessage =
  | { type: 'applied'; applied: AnnotationsApplied }
  /** Asks the poller, in whichever tab it runs, to read the feed now. */
  | { type: 'poll' };

type ChannelListener = (e: MessageEvent<AnnotationsMessage>) => void;

/** The part of a `BroadcastChannel` the annotations use. */
export interface AnnotationsChannel {
  postMessage(message: AnnotationsMessage): void;
  addEventListener(type: 'message', listener: ChannelListener): void;
  removeEventListener(type: 'message', listener: ChannelListener): void;
}

export const ANNOTATIONS_CHANNEL = 'tim-annotations';

export interface AnnotationStore {
  /**
   * Stores each of `list` newer than the stored one, the newest version winning, then tells every
   * tab's listeners what changed. Returns what changed.
   */
  apply(list: readonly Annotations[], source: AnnotationsSource): Promise<Annotations[]>;
  /** The stored annotations of those of `ids` that have any, tombstones included. */
  get(ids: Iterable<string>): Promise<Map<string, Annotations>>;
  /** Hears what any tab applies. Returns the unsubscribe. */
  subscribe(listener: (applied: AnnotationsApplied) => void): () => void;
  /** The channel to the other tabs, or `null` when the browser has none. */
  readonly channel: AnnotationsChannel | null;
}

/** The browser's annotations, in IndexedDB `annotations` and shared with other tabs on `channel`. */
export function createAnnotationStore(channel: AnnotationsChannel | null): AnnotationStore {
  const listeners = new Set<(applied: AnnotationsApplied) => void>();
  const tell = (applied: AnnotationsApplied) => {
    for (const listener of listeners) listener(applied);
  };
  channel?.addEventListener('message', (e) => {
    if (e.data.type === 'applied') tell(e.data.applied);
  });
  return {
    channel,
    async apply(list, source) {
      const changes = await annotationsDao.putNewer(list);
      if (changes.length === 0) return changes;
      const applied = { changes, source };
      tell(applied);
      channel?.postMessage({ type: 'applied', applied });
      return changes;
    },
    get: (ids) => annotationsDao.getMany(ids),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
