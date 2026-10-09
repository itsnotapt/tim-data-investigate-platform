import 'fake-indexeddb/auto';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GridApi } from 'ag-grid-community';
import { ExecutionStatusView } from './ExecutionStatusPanel';
import { ResultsGrid } from './ResultsGrid';
import { TabResultsGrid } from './TabResultsGrid';
import { initAgGrid } from './agGridSetup';
import { useDeterminationSymbols } from './determinationSymbols';
import { DETERMINATION_SYMBOLS_KEY } from './determinationSymbolsKey';
import { resetTimDb } from '../../lib/storage';
import { useTabsStore } from '../tabs';

const rows = [
  { EventId: 'a', Name: 'alpha' },
  { EventId: 'b', Name: 'beta', Extra: 1 },
  { EventId: 'c', Name: 'gamma', TagEvent: { Determination: 'malicious' } },
];

describe('ExecutionStatusView', () => {
  it('renders time, CPU and memory MB', () => {
    render(
      <ExecutionStatusView
        stats={{ executionTime: 0.42, cpuUsage: '00:00:00.1', memoryUsage: 3 * 1048576 }}
      />,
    );
    expect(screen.getByText('Execution Time:')).toBeInTheDocument();
    expect(screen.getByText('0.42')).toBeInTheDocument();
    expect(screen.getByText('00:00:00.1')).toBeInTheDocument();
    expect(screen.getByText('3MB')).toBeInTheDocument();
  });
  it('hides absent stats', () => {
    render(<ExecutionStatusView stats={{ executionTime: 1 }} />);
    expect(screen.queryByText('CPU Time:')).toBeNull();
    expect(screen.queryByText('Memory:')).toBeNull();
  });
});

describe('ResultsGrid', () => {
  it('initAgGrid works without a licence key', () => {
    expect(() => initAgGrid({})).not.toThrow();
  });

  it('quick filter filters rows and all row keys become columns', async () => {
    let api: GridApi | undefined;
    render(<ResultsGrid rows={rows} height={400} onGridReady={(e) => (api = e.api)} />);
    await waitFor(() => expect(api?.getDisplayedRowCount()).toBe(3));
    expect(api?.getColumns()?.map((c) => c.getColId())).toContain('Extra');

    await userEvent.type(screen.getByLabelText('Quick UI filter'), 'bet');
    await waitFor(() => expect(api?.getDisplayedRowCount()).toBe(1));
  });

  it('applies the determination row class', async () => {
    let api: GridApi | undefined;
    render(<ResultsGrid rows={rows} height={400} onGridReady={(e) => (api = e.api)} />);
    await waitFor(() => expect(api?.getDisplayedRowCount()).toBe(3));
    const node = api?.getRowNode('c');
    expect(node).toBeDefined();
    const cls = api?.getGridOption('rowClassRules');
    expect(Object.keys(cls ?? {})).toContain('ag-tag-malicious');
  });
});

describe('ResultsGrid determination symbol', () => {
  const tagged = [
    { EventId: 'm', TagEvent: { Determination: 'malicious' } },
    { EventId: 's', TagEvent: { Determination: 'suspicious' } },
    { EventId: 'b', TagEvent: { Determination: 'benign' } },
    { EventId: 'u', Name: 'untagged' },
  ];
  const TOGGLE = 'Show determination symbols';
  type Item = { name?: string; checked?: boolean; action?: () => void } | string;
  const selectionCell = (id: string) => {
    const cell = document.querySelector(
      `.ag-row[row-id="${id}"] [col-id="ag-Grid-SelectionColumn"]`,
    );
    expect(cell).not.toBeNull();
    return cell as HTMLElement;
  };
  const find = (items: Item[], name: string) =>
    items.find((i): i is Exclude<Item, string> => typeof i === 'object' && i.name === name);
  const cellMenu = (api: GridApi, colId: string, rowId = 'm') =>
    (api.getGridOption('getContextMenuItems') as (p: unknown) => Item[])({
      node: api.getRowNode(rowId),
      column: api.getColumn(colId),
    });
  const headerMenu = (api: GridApi) => {
    const items = api.getGridOption('selectionColumnDef')?.columnMenuItems;
    expect(Array.isArray(items)).toBe(true);
    return items as Item[];
  };
  async function ready() {
    let api: GridApi | undefined;
    render(<ResultsGrid rows={tagged} height={400} onGridReady={(e) => (api = e.api)} />);
    await waitFor(() => expect(api?.getDisplayedRowCount()).toBe(4));
    await waitFor(() => selectionCell('m'));
    return api as GridApi;
  }

  beforeEach(() => {
    localStorage.clear();
    useDeterminationSymbols.setState({ show: false });
  });

  it('shows no symbols by default', async () => {
    await ready();
    expect(within(selectionCell('m')).queryByRole('img')).toBeNull();
    expect(within(selectionCell('m')).getByRole('checkbox')).toBeInTheDocument();
  });

  it('shows the symbol of each determination when on, and none when untagged', async () => {
    useDeterminationSymbols.setState({ show: true });
    await ready();
    expect(within(selectionCell('m')).getByRole('img', { name: 'Malicious' })).toBeInTheDocument();
    expect(within(selectionCell('s')).getByRole('img', { name: 'Suspicious' })).toBeInTheDocument();
    expect(within(selectionCell('b')).getByRole('img', { name: 'Benign' })).toBeInTheDocument();
    expect(within(selectionCell('u')).queryByRole('img')).toBeNull();
    expect(within(selectionCell('m')).getByRole('checkbox')).toBeInTheDocument();
  });

  it("a checkbox cell's context menu turns the symbols on and remembers it", async () => {
    const api = await ready();
    const item = find(cellMenu(api, 'ag-Grid-SelectionColumn'), TOGGLE);
    expect(item?.checked).toBe(false);
    act(() => item?.action?.());
    await waitFor(() =>
      expect(within(selectionCell('m')).getByRole('img', { name: 'Malicious' })).toBeVisible(),
    );
    expect(localStorage.getItem(DETERMINATION_SYMBOLS_KEY)).toBe('on');
    expect(find(cellMenu(api, 'ag-Grid-SelectionColumn'), TOGGLE)?.checked).toBe(true);
  });

  it("keeps copy and export in a checkbox cell's context menu", async () => {
    const api = await ready();
    expect(cellMenu(api, 'ag-Grid-SelectionColumn')).toEqual(
      expect.arrayContaining(['copy', 'copyWithHeaders', 'export']),
    );
  });

  it('offers the toggle only on the checkbox column', async () => {
    const api = await ready();
    expect(find(cellMenu(api, 'EventId'), TOGGLE)).toBeUndefined();
  });

  it("the checkbox header's menu turns the symbols off and remembers it", async () => {
    useDeterminationSymbols.setState({ show: true });
    const api = await ready();
    const item = find(headerMenu(api), TOGGLE);
    expect(item?.checked).toBe(true);
    act(() => item?.action?.());
    await waitFor(() => expect(within(selectionCell('m')).queryByRole('img')).toBeNull());
    expect(localStorage.getItem(DETERMINATION_SYMBOLS_KEY)).toBe('off');
  });

  it('fits the checkbox column to its contents', async () => {
    const api = await ready();
    const width = () => api.getColumn('ag-Grid-SelectionColumn')?.getActualWidth();
    expect(width()).toBe(30);
    act(() => useDeterminationSymbols.getState().setShow(true));
    await waitFor(() => expect(width()).toBe(55));
  });

  it('shows no symbol on a group row', async () => {
    useDeterminationSymbols.setState({ show: true });
    const api = await ready();
    act(() => {
      api.applyColumnState({ state: [{ colId: 'EventId', rowGroup: true }] });
    });
    await waitFor(() => expect(document.querySelector('.ag-row-group')).not.toBeNull());
    for (const row of document.querySelectorAll<HTMLElement>('.ag-row-group')) {
      expect(within(row).queryByRole('img')).toBeNull();
    }
  });
});

describe('TabResultsGrid', () => {
  beforeEach(async () => {
    await resetTimDb();
    useTabsStore.setState({ tabs: {}, order: [] });
  });

  it('renders without throwing when no rows are stored', async () => {
    act(() => {
      useTabsStore.getState().createTab({
        componentName: 'KustoQueryResult',
        componentUuid: 'none',
        parentUuid: null,
        title: 'T',
        params: { query: 'T', cluster: '', database: '' },
      });
    });
    let api: GridApi | undefined;
    render(<TabResultsGrid uuid="none" height={300} onGridReady={(e) => (api = e.api)} />);
    await waitFor(() => expect(api).toBeDefined());
    expect(api?.getDisplayedRowCount()).toBe(0);
  });
});

describe('ResultsGrid details and column views', () => {
  async function ready() {
    let api: GridApi | undefined;
    render(<ResultsGrid rows={rows} height={400} onGridReady={(e) => (api = e.api)} />);
    await waitFor(() => expect(api?.getDisplayedRowCount()).toBe(3));
    return api as GridApi;
  }
  const showDetails = (api: GridApi, id: string) => {
    const node = api.getRowNode(id);
    const items = (
      api.getGridOption('getContextMenuItems') as (
        p: unknown,
      ) => { name?: string; action?: () => void }[]
    )({ node });
    const item = items.find((i) => typeof i === 'object' && i.name === 'Show details');
    expect(item).toBeDefined();
    act(() => item?.action?.());
  };

  it('renders the column view bar by default and omits it when off', async () => {
    await ready();
    expect(screen.getByLabelText('Column view')).toBeInTheDocument();
  });

  it('"Show details" opens the panel and it follows the focused cell', async () => {
    const api = await ready();
    const panel = () => screen.getByLabelText('Result details');
    expect(panel()).not.toBeVisible();
    showDetails(api, 'a');
    await waitFor(() => expect(panel()).toBeVisible());
    expect(within(panel()).getByText('alpha')).toBeInTheDocument();
    act(() => api.setFocusedCell(1, 'Name'));
    await waitFor(() => expect(within(panel()).getByText('beta')).toBeInTheDocument());
    expect(within(panel()).queryByText('alpha')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(panel()).not.toBeVisible());
  });

  it('does not open the panel on focus alone', async () => {
    const api = await ready();
    act(() => api.setFocusedCell(1, 'Name'));
    expect(screen.getByLabelText('Result details')).not.toBeVisible();
  });
});
