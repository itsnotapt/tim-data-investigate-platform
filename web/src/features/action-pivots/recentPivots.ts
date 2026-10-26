import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { parseJson, stringifyJson } from '../../lib/json';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/**
 * `localStorage` key of the recent pivots: a JSON list of their keys (`recentPivotKey`), the
 * latest first.
 */
export const RECENT_PIVOTS_KEY = 'tim-recent-pivots';
const KEEP = 3;

interface RecentPivotsState {
  /** Keys of the actions and presets of the analyst's last pivots, the latest first. */
  keys: readonly string[];
  record: (key: string) => void;
}

function read(storage: Storage): string[] {
  try {
    const stored: unknown = parseJson(storage.getItem(RECENT_PIVOTS_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((k) => typeof k === 'string').slice(0, KEEP) : [];
  } catch {
    return [];
  }
}

/** A store of the recent pivots, read from and written to `storage`; storage errors leave it empty. */
export function createRecentPivotsStore(
  storage: Storage,
): UseBoundStore<StoreApi<RecentPivotsState>> {
  return create<RecentPivotsState>((set, get) => ({
    keys: read(storage),
    record: (key) => {
      const keys = [key, ...get().keys.filter((k) => k !== key)].slice(0, KEEP);
      try {
        storage.setItem(RECENT_PIVOTS_KEY, stringifyJson(keys));
      } catch {
        // The keys still apply for this page.
      }
      set({ keys });
    },
  }));
}

export const useRecentPivots = createRecentPivotsStore(localStorage);
