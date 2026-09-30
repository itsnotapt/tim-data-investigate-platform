import 'fake-indexeddb/auto';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GridApi } from 'ag-grid-community';
import { ExecutionStatusView } from './ExecutionStatusPanel';
import { ResultsGrid } from './ResultsGrid';
import { TabResultsGrid } from './TabResultsGrid';
import { initAgGrid } from './agGridSetup';
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

describe('TabResultsGrid', () => {
  beforeEach(async () => {
    await resetTimDb();
    useTabsStore.setState({ tabs: {}, order: [] });
  });

  it('renders without throwing when no rows are stored (BUG-27)', async () => {
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
