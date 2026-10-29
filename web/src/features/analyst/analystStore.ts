import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { getMe } from '../../lib/api';

interface AnalystState {
  /** The name the API knows the signed-in analyst by: their comments' `author`. `null` until loaded. */
  name: string | null;
  /** Fetches the name. Throws on failure. */
  load(): Promise<void>;
}

export type AnalystStore = UseBoundStore<StoreApi<AnalystState>> & { reset(): void };

export function createAnalystStore(): AnalystStore {
  const useStore = create<AnalystState>()((set) => ({
    name: null,
    load: async () => set({ name: (await getMe()).name }),
  }));
  const store = useStore as AnalystStore;
  store.reset = () => useStore.setState({ name: null });
  return store;
}

/** App-wide singleton. */
export const useAnalystStore = createAnalystStore();

/** The name the API knows the signed-in analyst by, or `null` until it has loaded. */
export const useAnalyst = (): string | null => useAnalystStore((s) => s.name);
