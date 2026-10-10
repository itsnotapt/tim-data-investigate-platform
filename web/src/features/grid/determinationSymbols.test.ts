import { describe, expect, it } from 'vitest';
import { createDeterminationSymbolsStore } from './determinationSymbols';
import { DETERMINATION_SYMBOLS_KEY } from './determinationSymbolsKey';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe('determination symbols choice', () => {
  it('is off when nothing is stored', () => {
    expect(createDeterminationSymbolsStore(memoryStorage()).getState().show).toBe(false);
  });

  it('reads the stored choice', () => {
    const on = memoryStorage({ [DETERMINATION_SYMBOLS_KEY]: 'on' });
    const off = memoryStorage({ [DETERMINATION_SYMBOLS_KEY]: 'off' });
    expect(createDeterminationSymbolsStore(on).getState().show).toBe(true);
    expect(createDeterminationSymbolsStore(off).getState().show).toBe(false);
  });

  it('treats a junk value as off', () => {
    const junk = memoryStorage({ [DETERMINATION_SYMBOLS_KEY]: 'yes please' });
    expect(createDeterminationSymbolsStore(junk).getState().show).toBe(false);
  });

  it('stores the choice when it changes', () => {
    const storage = memoryStorage();
    const store = createDeterminationSymbolsStore(storage);
    store.getState().setShow(true);
    expect(store.getState().show).toBe(true);
    expect(storage.data.get(DETERMINATION_SYMBOLS_KEY)).toBe('on');
    store.getState().setShow(false);
    expect(storage.data.get(DETERMINATION_SYMBOLS_KEY)).toBe('off');
  });

  it('is off when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const store = createDeterminationSymbolsStore(broken);
    expect(store.getState().show).toBe(false);
    store.getState().setShow(true);
    expect(store.getState().show).toBe(true);
  });
});
