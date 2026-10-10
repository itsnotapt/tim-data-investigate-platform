import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { DETERMINATION_SYMBOLS_KEY } from './determinationSymbolsKey';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

interface DeterminationSymbolsState {
  /** Whether the checkbox column shows each row's determination symbol. Off by default. */
  show: boolean;
  setShow: (show: boolean) => void;
}

/** A store of the choice, read from and written to `storage`; storage errors leave it off. */
export function createDeterminationSymbolsStore(
  storage: Storage,
): UseBoundStore<StoreApi<DeterminationSymbolsState>> {
  let stored: string | null = null;
  try {
    stored = storage.getItem(DETERMINATION_SYMBOLS_KEY);
  } catch {
    stored = null;
  }
  return create<DeterminationSymbolsState>((set) => ({
    show: stored === 'on',
    setShow: (show) => {
      try {
        storage.setItem(DETERMINATION_SYMBOLS_KEY, show ? 'on' : 'off');
      } catch {
        // The choice still applies for this page.
      }
      set({ show });
    },
  }));
}

export const useDeterminationSymbols = createDeterminationSymbolsStore(localStorage);
