import { createLastSinkStore, LAST_SINK_KEY } from './lastSink';

const memory = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

describe('last sink', () => {
  it('keeps the key of the last sink run, across page loads', () => {
    const storage = memory();
    const store = createLastSinkStore(storage);
    expect(store.getState().key).toBeNull();
    store.getState().record('kusto');
    store.getState().record('case');
    expect(store.getState().key).toBe('case');
    expect(createLastSinkStore(storage).getState().key).toBe('case');
  });

  it('starts with none when storage is unreadable or holds something else', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const store = createLastSinkStore(broken);
    expect(store.getState().key).toBeNull();
    store.getState().record('kusto');
    expect(store.getState().key).toBe('kusto');
    expect(createLastSinkStore(memory({ [LAST_SINK_KEY]: '' })).getState().key).toBeNull();
  });
});
