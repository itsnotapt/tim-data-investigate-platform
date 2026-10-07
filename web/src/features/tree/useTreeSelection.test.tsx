import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { selectAllInOrder } from '../tabs';
import { toggleChecked, useTreeSelection } from './useTreeSelection';
import { kusto, newTestStore } from '../../test/tabsTestUtils';

function tree() {
  const store = newTestStore();
  const s = store.getState();
  // a -> b -> c ; a -> d ; e
  s.createTab(kusto('a'));
  s.createTab(kusto('b', 'a'));
  s.createTab(kusto('c', 'b'));
  s.createTab(kusto('d', 'a'));
  s.createTab(kusto('e'));
  return store;
}
const data = (store: ReturnType<typeof tree>) => store.getState();
const ids = (set: ReadonlySet<string>) => [...set].sort();

describe('toggleChecked', () => {
  it('checking a node checks its descendants', () => {
    const r = toggleChecked(data(tree()), new Set(), 'b', true);
    expect(ids(r)).toEqual(['b', 'c']);
  });

  it('checking all children does not check the parent', () => {
    const store = tree();
    let c = toggleChecked(data(store), new Set(), 'b', true);
    c = toggleChecked(data(store), c, 'd', true);
    expect(ids(c)).toEqual(['b', 'c', 'd']);
  });

  it('unchecking unchecks descendants and all ancestors but not siblings', () => {
    const store = tree();
    let c = toggleChecked(data(store), new Set(), 'a', true);
    c = toggleChecked(data(store), c, 'e', true);
    expect(ids(c)).toEqual(['a', 'b', 'c', 'd', 'e']);
    c = toggleChecked(data(store), c, 'b', false);
    expect(ids(c)).toEqual(['d', 'e']);
  });

  it('ignores unknown uuids', () => {
    expect(toggleChecked(data(tree()), new Set(['a']), 'zzz', true).size).toBe(1);
  });
});

function setup(initial: string) {
  const store = tree();
  let loc = '';
  const Probe = () => {
    loc = useLocation().pathname;
    return null;
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>
      <Probe />
      <Routes>
        <Route path="*" element={children} />
      </Routes>
    </MemoryRouter>
  );
  const active = initial.startsWith('/view/') ? initial.slice(6) : undefined;
  const hook = renderHook(() => useTreeSelection(active, store), { wrapper });
  return { store, hook, loc: () => loc };
}

describe('useTreeSelection.removeSelected', () => {
  it('removing a parent removes all descendants, leaves others', async () => {
    const { store, hook } = setup('/');
    act(() => hook.result.current.toggle('b', true));
    await act(() => hook.result.current.removeSelected());
    expect(selectAllInOrder(store.getState()).map((t) => t.componentUuid)).toEqual(['a', 'd', 'e']);
    expect(hook.result.current.checked.size).toBe(0);
  });

  it('navigates to / when the active tab was removed', async () => {
    const { hook, loc } = setup('/view/c');
    act(() => hook.result.current.toggle('a', true));
    await act(() => hook.result.current.removeSelected());
    expect(loc()).toBe('/');
  });

  it('keeps the route when the active tab survives', async () => {
    const { hook, loc } = setup('/view/e');
    act(() => hook.result.current.toggle('a', true));
    await act(() => hook.result.current.removeSelected());
    expect(loc()).toBe('/view/e');
  });
});
