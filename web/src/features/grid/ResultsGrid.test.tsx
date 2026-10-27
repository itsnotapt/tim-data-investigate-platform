import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { GridApi } from 'ag-grid-community';
import { ResultsGrid } from './ResultsGrid';
import { initAgGrid } from './agGridSetup';

const rows = [
  { row: 0, EventId: 'a', Name: 'alpha' },
  { row: 1, EventId: 'a', Name: 'beta', Extra: 1 },
  { row: 2, Name: 'gamma' },
];

type Item = { name?: string } | string;

async function ready() {
  let api: GridApi | undefined;
  render(<ResultsGrid rows={rows} height={400} onGridReady={(e) => (api = e.api)} />);
  await waitFor(() => expect(api?.getDisplayedRowCount()).toBe(3));
  return api as GridApi;
}

describe('ResultsGrid', () => {
  it('initAgGrid works without a licence key', () => {
    expect(() => initAgGrid({})).not.toThrow();
  });

  it('quick filter filters rows and all row keys become columns', async () => {
    const api = await ready();
    expect(api.getColumns()?.map((c) => c.getColId())).toContain('Extra');

    await userEvent.type(screen.getByLabelText('Quick UI filter'), 'bet');
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(1));
  });

  it("uses each row's row number as its grid row id", async () => {
    const api = await ready();
    expect(api.getRowNode('0')?.data).toEqual(rows[0]);
    expect(api.getRowNode('1')?.data).toEqual(rows[1]);
    expect(api.getRowNode('2')?.data).toEqual(rows[2]);
    expect(api.getRowNode('a')).toBeUndefined();
  });

  it('shows only the checkbox in the selection column without a symbol', async () => {
    const api = await ready();
    const cell = await waitFor(() => {
      const found = document.querySelector(
        '.ag-row[row-id="0"] [col-id="ag-Grid-SelectionColumn"]',
      );
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(within(cell).getByRole('checkbox')).toBeInTheDocument();
    expect(within(cell).queryByRole('img')).toBeNull();
    expect(api.getColumn('ag-Grid-SelectionColumn')?.getActualWidth()).toBe(30);
  });

  it("offers copy and export in a checkbox cell's context menu", async () => {
    const api = await ready();
    const items = (api.getGridOption('getContextMenuItems') as (p: unknown) => Item[])({
      node: api.getRowNode('0'),
      column: api.getColumn('ag-Grid-SelectionColumn'),
    });
    expect(items.map((i) => (typeof i === 'string' ? i : i.name))).toEqual([
      'copy',
      'copyWithHeaders',
      'export',
    ]);
  });
});
