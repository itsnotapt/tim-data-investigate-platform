import 'fake-indexeddb/auto';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnState, GridApi, MenuItemDef } from 'ag-grid-community';
import { load } from 'js-yaml';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueColumn, RunColumn, RunRow } from '../../lib/api';
import { SnackbarHost } from '../../components/SnackbarHost';
import { useTabsStore } from '../tabs';
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

function renderGrid(
  uuid: string,
  shown: readonly RunRow[] = rows,
  declaredColumns: readonly CatalogueColumn[] = declared,
) {
  let api: GridApi | undefined;
  const grid = (r: readonly RunRow[]) => (
    <ActionResultsGrid
      uuid={uuid}
      action="dev.sign_ins"
      rows={r}
      declaredColumns={declaredColumns}
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

async function gridOf(uuid: string, declaredColumns?: readonly CatalogueColumn[]) {
  const api = await renderGrid(uuid, rows, declaredColumns).api();
  await waitFor(() => expect(api.getDisplayedRowCount()).toBeGreaterThan(0));
  return api;
}

const stateOf = (api: GridApi, colId: string): ColumnState | undefined =>
  api.getColumnState().find((c) => c.colId === colId);

let clipboard: string | null;

beforeEach(() => {
  useTabsStore.reset();
  clipboard = null;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (t: string) => {
        clipboard = t;
        return Promise.resolve();
      },
    },
  });
});

type Item = string | MenuItemDef;
const find = (items: Item[], name: string) =>
  items.find((i): i is MenuItemDef => typeof i === 'object' && i.name === name);

/** The `columns:` block for the `declared` and run columns, as the grid lays them out. */
const declaredBlock = [
  { name: 'Timestamp', type: 'datetime', width: 180, pinned: 'left', sort: 'desc' },
  { name: 'User', type: 'string', title: 'Analyst', group: true },
  { name: 'Raw', type: 'json', hidden: true },
  { name: 'KiB', type: 'number', title: 'Size (KiB)', calculated: '[Raw Bytes] / 1024' },
  { name: 'row', type: 'string' },
  { name: 'Raw Bytes', type: 'number' },
];

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

  it("puts the tab's own grid state over the declared settings", async () => {
    const uuid = useTabsStore.getState().createTab({
      componentName: 'ActionResult',
      parentUuid: null,
      title: 'Sign-ins',
      params: { action: 'dev.sign_ins', params: {} },
    });
    useTabsStore.getState().updateState(uuid, {
      gridState: {
        partialColumnState: true,
        columnOrder: { orderedColIds: ['Timestamp', 'User', 'Raw', 'KiB', 'row', 'Raw Bytes'] },
        columnVisibility: { hiddenColIds: [] },
        columnPinning: { leftColIds: [], rightColIds: [] },
        columnSizing: { columnSizingModel: [{ colId: 'Timestamp', width: 90 }] },
        sort: { sortModel: [] },
      },
    });
    const api = await gridOf(uuid);
    await waitFor(() => expect(stateOf(api, 'Raw')).toMatchObject({ hide: false }));
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
    expect(order).toEqual([
      'Timestamp',
      'User',
      'Raw',
      'KiB',
      'row',
      'Raw Bytes',
      'tim:comments',
      'tim:tags',
      'tim:commentText',
      'tim:label',
    ]);
  });

  it("applies a declared tim: column's settings to TIM's own column, after the declared column before it", async () => {
    const api = await gridOf('tim', [
      { name: 'Timestamp', type: 'datetime', hidden: false, group: false },
      {
        name: 'tim:label',
        type: 'string',
        title: 'Verdict',
        hidden: false,
        group: false,
        width: 120,
        pinned: 'left',
      },
      { name: 'tim:comments', type: 'number', hidden: true, width: 140, group: false },
      { name: 'User', type: 'string', hidden: false, group: false },
    ]);
    expect(stateOf(api, 'tim:label')).toMatchObject({ hide: false, width: 120, pinned: 'left' });
    expect(api.getColumn('tim:label')?.getColDef().headerName).toBe('Verdict');
    expect(stateOf(api, 'tim:comments')).toMatchObject({ hide: true, width: 140 });
    const order = api
      .getColumnState()
      .map((c) => c.colId)
      .filter((id) => !id.startsWith('ag-Grid-'));
    expect(order).toEqual([
      'Timestamp',
      'tim:label',
      'tim:comments',
      'User',
      'Raw',
      'row',
      'Raw Bytes',
      'tim:tags',
      'tim:commentText',
    ]);
  });

  it('copies the column settings as an action file from the right-click menu', async () => {
    const api = await gridOf('copy-cell');
    const items = (api.getGridOption('getContextMenuItems') as (p: unknown) => Item[])({
      api,
      node: api.getRowNode('0'),
      column: api.getColumn('Timestamp'),
    });
    act(() => find(items, 'Copy column settings (action file)')?.action?.({} as never));
    await waitFor(() => expect(clipboard).not.toBeNull());
    expect(load(clipboard!)).toEqual({ columns: declaredBlock });
  });

  it('copies the column settings as an action file from the column menu', async () => {
    const api = await gridOf('copy-header');
    const items = (api.getGridOption('getMainMenuItems') as (p: unknown) => Item[])({
      api,
      column: api.getColumn('Timestamp'),
      defaultItems: ['pinSubMenu'],
    });
    expect(items[0]).toBe('pinSubMenu');
    act(() => find(items, 'Copy column settings (action file)')?.action?.({} as never));
    await waitFor(() => expect(clipboard).not.toBeNull());
    expect(load(clipboard!)).toEqual({ columns: declaredBlock });
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

  it('focuses the linked row and opens its History once the row has arrived', async () => {
    const shown = vi.fn();
    let api: GridApi | undefined;
    const grid = (r: readonly RunRow[]) => (
      <ActionResultsGrid
        uuid="linked"
        action="dev.sign_ins"
        rows={r}
        declaredColumns={declared}
        runColumns={columns}
        height={400}
        linkedRow={1}
        onLinkedRowShown={shown}
        onGridReady={(e) => (api = e.api)}
      />
    );
    const { rerender } = render(grid(rows.slice(0, 1)));
    await waitFor(() => expect(api?.getDisplayedRowCount()).toBeGreaterThan(0));
    expect(screen.queryByRole('complementary', { name: 'History' })).not.toBeInTheDocument();
    expect(shown).not.toHaveBeenCalled();

    rerender(grid(rows));
    const history = await screen.findByRole('complementary', { name: 'History' });
    expect(within(history).getByText('c-1')).toBeInTheDocument();
    await waitFor(() => {
      const focused = api!.getFocusedCell();
      expect(focused).not.toBeNull();
      expect(api!.getDisplayedRowAtIndex(focused!.rowIndex)?.id).toBe('1');
    });
    expect(shown).toHaveBeenCalledTimes(1);
  });

  it("copies a link to the right-clicked row from the row's menu", async () => {
    userEvent.setup(); // a clipboard to read back
    let api: GridApi | undefined;
    render(
      <SnackbarHost>
        <ActionResultsGrid
          uuid="link"
          action="dev.sign_ins"
          runId="r1"
          rows={rows}
          runColumns={columns}
          height={400}
          onGridReady={(e) => (api = e.api)}
        />
      </SnackbarHost>,
    );
    await waitFor(() => expect(api?.getDisplayedRowCount()).toBe(2));
    const items = (
      api!.getGridOption('getContextMenuItems') as (p: unknown) => (string | MenuItemDef)[]
    )({ api, node: api!.getRowNode('1'), column: api!.getColumn('User') });
    const names = items.map((i) => (typeof i === 'string' ? i : i.name));
    expect(names.slice(-5)).toEqual([
      'Copy link',
      'separator',
      'copy',
      'copyWithHeaders',
      'export',
    ]);
    const copyLink = items.find(
      (i): i is MenuItemDef => typeof i === 'object' && i.name === 'Copy link',
    );
    act(() => (copyLink!.action as () => void)());
    expect(await screen.findByText('Copied a link to this row')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('http://localhost:3000/#/runs/r1?row=1');
  });
});

describe('ActionResultsGrid with whole numbers beyond 2^53', () => {
  async function bigGrid(uuid: string, shown: readonly RunRow[], runColumns: RunColumn[]) {
    let api: GridApi | undefined;
    render(
      <ActionResultsGrid
        uuid={uuid}
        action="dev.hashes"
        rows={shown}
        runColumns={runColumns}
        height={400}
        onGridReady={(e) => (api = e.api)}
      />,
    );
    await waitFor(() => expect(api?.getDisplayedRowCount()).toBe(shown.length));
    return api!;
  }
  const values = (api: GridApi) => {
    const found: unknown[] = [];
    api.forEachNodeAfterFilterAndSort((node) =>
      found.push(api.getCellValue({ rowNode: node, colKey: 'Hash' })),
    );
    return found;
  };

  describe('in a bigint column', () => {
    const hashes: RunRow[] = [
      { row: 0, id: 'h-0', data: { Hash: '12345678901234567890' } },
      { row: 1, id: 'h-1', data: { Hash: '5' } },
      { row: 2, id: 'h-2', data: { Hash: '-9007199254740993' } },
      { row: 3, id: 'h-3', data: { Hash: null } },
    ];
    const hashColumns: RunColumn[] = [{ name: 'Hash', type: 'bigint', declared: true }];

    it('filters them exactly with the bigint filter', async () => {
      const api = await bigGrid('bigint-filter', hashes, hashColumns);

      await act(async () => {
        await api.setColumnFilterModel('Hash', {
          filterType: 'multi',
          filterModels: [
            null,
            { filterType: 'bigint', type: 'lessThan', filter: '-9007199254740992' },
          ],
        });
        api.onFilterChanged();
      });

      await waitFor(() => expect(values(api)).toEqual([-9007199254740993n]));
    });

    it('sorts them exactly', async () => {
      const api = await bigGrid('bigint-sort', hashes, hashColumns);

      act(() => {
        api.applyColumnState({ state: [{ colId: 'Hash', sort: 'desc' }] });
      });

      expect(values(api)).toEqual([12345678901234567890n, 5n, -9007199254740993n, null]);
    });

    it('copies one exactly', async () => {
      const api = await bigGrid('bigint-copy', hashes, hashColumns);

      act(() => {
        api.setFocusedCell(0, 'Hash');
        api.copyToClipboard();
      });

      await waitFor(() => expect(clipboard).toBe('12345678901234567890'));
    });
  });

  it('warns in the header of a number column that has them', async () => {
    await bigGrid(
      'number-warning',
      [
        { row: 0, id: 'n-0', data: { Hash: 2 ** 64, Count: 5 } },
        { row: 1, id: 'n-1', data: { Hash: 7, Count: 2 ** 53 - 1 } },
      ],
      [
        { name: 'Hash', type: 'number', declared: false },
        { name: 'Count', type: 'number', declared: false },
      ],
    );

    const warnings = await screen.findAllByLabelText(/Declare the column as bigint/);
    expect(warnings.map((w) => w.closest('[col-id]')?.getAttribute('col-id'))).toEqual(['Hash']);
  });
});
