import 'fake-indexeddb/auto';
import { render, waitFor } from '@testing-library/react';
import type { ColumnState, GridApi } from 'ag-grid-community';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogueColumn, RunColumn, RunRow } from '../../lib/api';
import { tabColumnState } from '../column-views';
import { ActionResultsGrid } from './ActionResultsGrid';

const declared: CatalogueColumn[] = [
  {
    name: 'Timestamp',
    type: 'datetime',
    hidden: false,
    group: false,
    width: 180,
    pinned: 'left',
    sort: 'desc',
  },
  { name: 'User', type: 'string', title: 'Analyst', hidden: false, group: true },
  { name: 'Raw', type: 'json', hidden: true, group: false },
  {
    name: 'KiB',
    type: 'number',
    title: 'Size (KiB)',
    hidden: false,
    group: false,
    calculated: '[Raw Bytes] / 1024',
  },
];
const columns: RunColumn[] = [
  { name: 'Timestamp', type: 'datetime', declared: true },
  { name: 'User', type: 'string', declared: true },
  { name: 'Raw', type: 'json', declared: true },
  { name: 'row', type: 'string', declared: false },
  { name: 'Raw Bytes', type: 'number', declared: false },
];
const rows: RunRow[] = [
  {
    row: 0,
    id: 'c-1',
    data: {
      Timestamp: '2026-10-01T08:00:00Z',
      User: 'alice',
      Raw: {},
      row: 'first',
      'Raw Bytes': 2048,
    },
  },
  {
    row: 1,
    id: 'c-1',
    data: {
      Timestamp: '2026-10-01T08:05:00Z',
      User: 'bob',
      Raw: {},
      row: 'second',
      'Raw Bytes': 512,
    },
  },
];

function renderGrid(uuid: string, shown: readonly RunRow[] = rows) {
  let api: GridApi | undefined;
  const grid = (r: readonly RunRow[]) => (
    <ActionResultsGrid
      uuid={uuid}
      action="dev.sign_ins"
      rows={r}
      declaredColumns={declared}
      runColumns={columns}
      height={400}
      onGridReady={(e) => (api = e.api)}
    />
  );
  const { rerender } = render(grid(shown));
  return {
    api: async () => {
      await waitFor(() => expect(api).toBeDefined());
      return api!;
    },
    rerender: (r: readonly RunRow[]) => rerender(grid(r)),
  };
}

async function gridOf(uuid: string) {
  const api = await renderGrid(uuid).api();
  await waitFor(() => expect(api.getDisplayedRowCount()).toBeGreaterThan(0));
  return api;
}

const stateOf = (api: GridApi, colId: string): ColumnState | undefined =>
  api.getColumnState().find((c) => c.colId === colId);

beforeEach(() => tabColumnState.clear());

describe('ActionResultsGrid', () => {
  it('applies the declared columns as initial settings', async () => {
    const api = await gridOf('declared');
    expect(stateOf(api, 'Timestamp')).toMatchObject({ width: 180, pinned: 'left', sort: 'desc' });
    expect(stateOf(api, 'Raw')).toMatchObject({ hide: true });
    expect(stateOf(api, 'User')).toMatchObject({ rowGroup: true });
    expect(api.getColumn('User')?.getColDef().headerName).toBe('Analyst');
  });

  it('keys rows by `row`, and a result column called `row` keeps its own values', async () => {
    const api = await gridOf('ids');
    const node = api.getRowNode('1');
    expect(node).toBeDefined();
    expect(api.getCellValue({ rowNode: node!, colKey: 'row' })).toBe('second');
  });

  it('lets restored tab state win over the declared settings', async () => {
    tabColumnState.set('restored', [
      { colId: 'Raw', hide: false },
      { colId: 'Timestamp', width: 90, pinned: null, sort: null },
    ]);
    const api = await gridOf('restored');
    expect(stateOf(api, 'Raw')).toMatchObject({ hide: false });
    expect(stateOf(api, 'Timestamp')).toMatchObject({ width: 90, pinned: null, sort: null });
  });

  it('evaluates a declared calculated column, after the declared column before it', async () => {
    const api = await gridOf('calculated');
    const node = api.getRowNode('0');
    expect(api.getCellValue({ rowNode: node!, colKey: 'KiB' })).toBe(2);
    expect(api.getColumn('KiB')?.getColDef().headerName).toBe('Size (KiB)');
    const order = api
      .getColumnState()
      .map((c) => c.colId)
      .filter((id) => !id.startsWith('ag-Grid-'));
    expect(order).toEqual(['Timestamp', 'User', 'Raw', 'KiB', 'row', 'Raw Bytes', 'tim:label']);
  });

  it('adds the rows of each page that arrives, and replaces rows that are not a continuation', async () => {
    const grid = renderGrid('growing', rows.slice(0, 1));
    const api = await grid.api();
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(1));
    grid.rerender(rows);
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(2));
    expect(api.getCellValue({ rowNode: api.getRowNode('1')!, colKey: 'User' })).toBe('bob');
    grid.rerender([{ row: 0, id: 'c-9', data: { User: 'dave' } }]);
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(1));
    expect(api.getCellValue({ rowNode: api.getRowNode('0')!, colKey: 'User' })).toBe('dave');
  });
});
