import { create, type StoreApi, type UseBoundStore } from 'zustand';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/** `localStorage` key of the last sink the analyst ran: its action key. */
export const LAST_SINK_KEY = 'tim-last-sink';

interface LastSinkState {
  /** The key of the last sink run, which the Annotate dialog picks first. */
  key: string | null;
  record: (key: string) => void;
}

function read(storage: Storage): string | null {
  try {
    return storage.getItem(LAST_SINK_KEY) || null;
  } catch {
    return null;
  }
}

/** A store of the last sink run, read from and written to `storage`; storage errors leave none. */
export function createLastSinkStore(storage: Storage): UseBoundStore<StoreApi<LastSinkState>> {
  return create<LastSinkState>((set) => ({
    key: read(storage),
    record: (key) => {
      try {
        storage.setItem(LAST_SINK_KEY, key);
      } catch {
        // The key still applies for this page.
      }
      set({ key });
    },
  }));
}

export const useLastSink = createLastSinkStore(localStorage);
