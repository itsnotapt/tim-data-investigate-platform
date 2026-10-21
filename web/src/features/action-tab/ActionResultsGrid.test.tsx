import 'fake-indexeddb/auto';
import { render, waitFor } from '@testing-library/react';
import type { ColumnState, GridApi } from 'ag-grid-community';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogueColumn, RunColumn, RunRow } from '../../lib/api';
import { rowResultsDao } from '../../lib/storage';
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
];
const columns: RunColumn[] = [
  { name: 'Timestamp', type: 'datetime', declared: true },
  { name: 'User', type: 'string', declared: true },
  { name: 'Raw', type: 'json', declared: true },
  { name: 'row', type: 'string', declared: false },
];
const rows: RunRow[] = [
  {
    row: 0,
    id: 'c-1',
    data: { Timestamp: '2026-10-01T08:00:00Z', User: 'alice', Raw: {}, row: 'first' },
  },
  {
    row: 1,
    id: 'c-1',
    data: { Timestamp: '2026-10-01T08:05:00Z', User: 'bob', Raw: {}, row: 'second' },
  },
];

async function renderGrid(uuid: string) {
  await rowResultsDao.put(uuid, rows);
  let api: GridApi | undefined;
  render(
    <ActionResultsGrid
      uuid={uuid}
      rowDataTrigger={1}
      declaredColumns={declared}
      runColumns={columns}
      height={400}
      onGridReady={(e) => (api = e.api)}
    />,
  );
  await waitFor(() => expect(api?.getDisplayedRowCount()).toBeGreaterThan(0));
  return api!;
}

const stateOf = (api: GridApi, colId: string): ColumnState | undefined =>
  api.getColumnState().find((c) => c.colId === colId);

beforeEach(() => tabColumnState.clear());

describe('ActionResultsGrid', () => {
  it('applies the declared columns as initial settings', async () => {
    const api = await renderGrid('declared');
    expect(stateOf(api, 'Timestamp')).toMatchObject({ width: 180, pinned: 'left', sort: 'desc' });
    expect(stateOf(api, 'Raw')).toMatchObject({ hide: true });
    expect(stateOf(api, 'User')).toMatchObject({ rowGroup: true });
    expect(api.getColumn('User')?.getColDef().headerName).toBe('Analyst');
  });

  it('keys rows by `row`, and a result column called `row` keeps its own values', async () => {
    const api = await renderGrid('ids');
    const node = api.getRowNode('1');
    expect(node).toBeDefined();
    expect(api.getCellValue({ rowNode: node!, colKey: 'row' })).toBe('second');
  });

  it('lets restored tab state win over the declared settings', async () => {
    tabColumnState.set('restored', [
      { colId: 'Raw', hide: false },
      { colId: 'Timestamp', width: 90, pinned: null, sort: null },
    ]);
    const api = await renderGrid('restored');
    expect(stateOf(api, 'Raw')).toMatchObject({ hide: false });
    expect(stateOf(api, 'Timestamp')).toMatchObject({ width: 90, pinned: null, sort: null });
  });
});
