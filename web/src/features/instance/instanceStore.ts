import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { getInstance, type Instance } from '../../lib/api';

interface InstanceState {
  /** `null` until the first load. */
  instance: Instance | null;
  /** Fetch once; later calls resolve immediately. Throws on failure. */
  load(): Promise<void>;
  /** Refetch, and take the result only when its `version` differs. Throws on failure. */
  refresh(): Promise<void>;
}

export interface InstanceStoreOptions {
  fetchInstance?: () => Promise<Instance>;
}

export type InstanceStore = UseBoundStore<StoreApi<InstanceState>> & { reset(): void };

export function createInstanceStore(options: InstanceStoreOptions = {}): InstanceStore {
  const fetchInstance = options.fetchInstance ?? (() => getInstance());
  let inflight: Promise<void> | null = null;

  const useStore = create<InstanceState>()((set, get) => {
    const fetch = (): Promise<void> => {
      // Concurrent callers share one request.
      inflight ??= (async () => {
        try {
          const next = await fetchInstance();
          if (next.version !== get().instance?.version) set({ instance: next });
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    };
    return {
      instance: null,
      load: () => (get().instance ? Promise.resolve() : fetch()),
      refresh: fetch,
    };
  });

  const store = useStore as InstanceStore;
  store.reset = () => {
    inflight = null;
    useStore.setState({ instance: null });
  };
  return store;
}

/**
 * Refreshes the instance whenever `target` (the window) gains focus. A failed refetch keeps the
 * instance already loaded. Returns the cleanup.
 */
export function refreshInstanceOnFocus(
  store: InstanceStore,
  target: EventTarget = window,
): () => void {
  const onFocus = () => {
    store
      .getState()
      .refresh()
      .catch((e: unknown) => console.warn('Instance refresh failed', e));
  };
  target.addEventListener('focus', onFocus);
  return () => target.removeEventListener('focus', onFocus);
}

/** App-wide singleton. */
export const useInstanceStore = createInstanceStore();
