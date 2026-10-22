import { createRecentPivotsStore, RECENT_PIVOTS_KEY } from './recentPivots';

const memory = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

describe('recent pivots', () => {
  it('keeps the last 3 pivots, the latest first and each once, across page loads', () => {
    const storage = memory();
    const store = createRecentPivotsStore(storage);
    for (const key of ['a', 'b', 'c', 'a', 'd']) store.getState().record(key);
    expect(store.getState().keys).toEqual(['d', 'a', 'c']);
    expect(createRecentPivotsStore(storage).getState().keys).toEqual(['d', 'a', 'c']);
  });

  it('starts empty when storage is unreadable or holds something else', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const store = createRecentPivotsStore(broken);
    expect(store.getState().keys).toEqual([]);
    store.getState().record('a');
    expect(store.getState().keys).toEqual(['a']);
    const odd = memory({ [RECENT_PIVOTS_KEY]: '{"not":"a list"}' });
    expect(createRecentPivotsStore(odd).getState().keys).toEqual([]);
  });
});
