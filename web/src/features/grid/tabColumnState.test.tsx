import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridApi } from 'ag-grid-community';
import { tabColumnState } from '../column-views';
import { ResultsGrid } from './ResultsGrid';

const rows = [{ EventId: 'a', Name: 'alpha', Other: 1 }];

let callbacks: ResizeObserverCallback[] = [];
class FakeResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    callbacks.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
const resize = (width: number, height: number) =>
  void act(() =>
    callbacks.forEach((cb) =>
      cb([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver),
    ),
  );

describe('column state survives tab switching (P4-16)', () => {
  beforeEach(() => {
    callbacks = [];
    tabColumnState.clear();
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  const widthOf = (api: GridApi, id: string) =>
    api.getColumnState().find((c) => c.colId === id)?.width;

  it('saves on hide and restores on show', async () => {
    let api: GridApi | undefined;
    render(
      <ResultsGrid stateKey="t1" rows={rows} height={300} onGridReady={(e) => (api = e.api)} />,
    );
    await waitFor(() => expect(api?.getDisplayedRowCount()).toBe(1));
    void act(() => api?.applyColumnState({ state: [{ colId: 'Name', width: 321, hide: false }] }));
    expect(widthOf(api as GridApi, 'Name')).toBe(321);

    resize(0, 0); // tab hidden
    expect(
      (tabColumnState.get('t1') as { colId: string; width: number }[]).find(
        (c) => c.colId === 'Name',
      )?.width,
    ).toBe(321);

    // Something resets the layout while hidden.
    void act(() => api?.applyColumnState({ state: [{ colId: 'Name', width: 150 }] }));
    resize(800, 300); // tab shown
    expect(widthOf(api as GridApi, 'Name')).toBe(321);
  });

  it('restores into a re-created grid and saves on unmount', async () => {
    let api: GridApi | undefined;
    const first = render(
      <ResultsGrid stateKey="t2" rows={rows} height={300} onGridReady={(e) => (api = e.api)} />,
    );
    await waitFor(() => expect(api?.getDisplayedRowCount()).toBe(1));
    void act(() => api?.applyColumnState({ state: [{ colId: 'Name', width: 222 }] }));
    // AG Grid debounces `stateUpdated`, which drives the save.
    await waitFor(() => expect(tabColumnState.get('t2')).toBeDefined());
    await new Promise((r) => setTimeout(r, 50));
    first.unmount();
    expect(tabColumnState.get('t2')).toBeDefined();

    let api2: GridApi | undefined;
    render(
      <ResultsGrid stateKey="t2" rows={rows} height={300} onGridReady={(e) => (api2 = e.api)} />,
    );
    await waitFor(() => expect(api2?.getDisplayedRowCount()).toBe(1));
    expect(widthOf(api2 as GridApi, 'Name')).toBe(222);
  });
});
