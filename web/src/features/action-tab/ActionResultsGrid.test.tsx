import 'fake-indexeddb/auto';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnState, GridApi, MenuItemDef } from 'ag-grid-community';
import { load } from 'js-yaml';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotations, CatalogueColumn, RunColumn, RunRow } from '../../lib/api';
import { AuthProvider, createAuthClient, DEV_ACCOUNT } from '../../lib/auth';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { SnackbarHost } from '../../components/SnackbarHost';
import { getAnnotationStore } from '../../lib/annotations';
import { annotated } from '../../test/annotationFakes';
import type { LabelledRow } from '../labels';
import { useTabsStore } from '../tabs';
import { ActionResultsGrid } from './ActionResultsGrid';

const server = setupMswServer();

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
    // A declared type doesn't change one of TIM's own columns.
    expect(api.getColumn('tim:comments')?.getColDef().filter).toBe('agTextColumnFilter');
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

  it('focuses the linked row and opens its Row detail once the row has arrived', async () => {
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
    expect(screen.queryByRole('complementary', { name: 'Row detail' })).not.toBeInTheDocument();
    expect(shown).not.toHaveBeenCalled();

    rerender(grid(rows));
    const detail = await screen.findByRole('complementary', { name: 'Row detail' });
    expect(within(detail).getByText('c-1')).toBeInTheDocument();
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

describe('ActionResultsGrid Row detail', () => {
  const idless: RunRow[] = [
    { row: 0, id: null, data: { User: 'alice', Host: 'h1' } },
    { row: 1, id: null, data: { User: 'bob', Host: 'h2' } },
  ];
  const names = (items: Item[]) => items.map((i) => (typeof i === 'string' ? i : i.name));
  const menuOf = (api: GridApi, row: string) =>
    (api.getGridOption('getContextMenuItems') as (p: unknown) => Item[])({
      api,
      node: api.getRowNode(row),
      column: api.getColumn('User'),
    });
  /** Presses `key` in the first row's User cell. */
  const press = (api: GridApi, key: string) => {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    act(() =>
      (api.getGridOption('onCellKeyDown') as (e: unknown) => void)({
        api,
        node: api.getRowNode('0'),
        column: api.getColumn('User'),
        event,
      }),
    );
    return event;
  };
  const panel = () => screen.queryByRole('complementary', { name: 'Row detail' });

  it('offers Label ▸, Annotate…, Comment… and Row detail first, with Row detail never disabled', async () => {
    const api = await renderGrid('menu', idless).api();
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(2));
    const items = menuOf(api, '0');
    expect(names(items).slice(0, 5)).toEqual([
      'Label',
      'Annotate…',
      'Comment…',
      'Row detail',
      'separator',
    ]);
    expect(names(items)).not.toContain('Show details');
    expect(names(items)).not.toContain('History');
    const rowDetail = find(items, 'Row detail');
    expect(rowDetail?.shortcut).toBe('D');
    expect(rowDetail?.disabled).toBeFalsy();
  });

  it('toggles with D on a row without an id, and H does nothing', async () => {
    const api = await renderGrid('keys', idless).api();
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(2));

    expect(press(api, 'h').defaultPrevented).toBe(false);
    expect(panel()).not.toBeInTheDocument();
    expect(press(api, 'd').defaultPrevented).toBe(true);
    expect(within(panel()!).getByText('row 0', { exact: false })).toBeInTheDocument();
    press(api, 'D');
    expect(panel()).not.toBeInTheDocument();
  });

  it("follows the focused row, with the fields in the run's column order", async () => {
    const api = await renderGrid('follow', rows, []).api();
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(2));
    press(api, 'd');
    const terms = () =>
      within(panel()!)
        .getAllByRole('term')
        .map((t) => t.textContent);
    expect(terms()).toEqual(['Timestamp', 'User', 'row', 'Raw Bytes']);
    expect(within(panel()!).getByText('alice')).toBeInTheDocument();

    act(() => api.moveColumns(['Raw Bytes'], 0));
    act(() => api.setFocusedCell(1, 'User'));
    expect(await within(panel()!).findByText('row 1', { exact: false })).toBeInTheDocument();
    expect(within(panel()!).getByText('bob')).toBeInTheDocument();
    expect(terms()).toEqual(['Timestamp', 'User', 'row', 'Raw Bytes']);
  });

  it("keeps a row's comment draft while the focus moves, and drops it on close", async () => {
    const user = userEvent.setup();
    const shown = [rows[0]!, { ...rows[1]!, id: 'c-2' }];
    const api = await renderGrid('drafts', shown, []).api();
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(2));
    press(api, 'd');
    await user.type(within(panel()!).getByLabelText('Comment'), 'half typed');

    act(() => api.setFocusedCell(1, 'User'));
    await within(panel()!).findByText('row 1', { exact: false });
    expect(within(panel()!).getByLabelText('Comment')).toHaveValue('');
    act(() => api.setFocusedCell(0, 'User'));
    await within(panel()!).findByText('row 0', { exact: false });
    expect(within(panel()!).getByLabelText('Comment')).toHaveValue('half typed');

    press(api, 'd');
    press(api, 'd');
    expect(within(panel()!).getByLabelText('Comment')).toHaveValue('');
  });

  it("shows the next row's label as soon as it moves there", async () => {
    await getAnnotationStore().apply(
      [annotated('f-2', 1, 'malicious', 'labeller@example.com')],
      'feed',
    );
    const shown = [
      { ...rows[0]!, id: 'f-1' },
      { ...rows[1]!, id: 'f-2' },
    ];
    const api = await renderGrid('next-label', shown, []).api();
    await waitFor(() =>
      expect((api.getRowNode('1')?.data as LabelledRow | undefined)?.annotations).toBeDefined(),
    );
    press(api, 'd');

    act(() => api.setFocusedCell(1, 'User'));
    await within(panel()!).findByText('row 1', { exact: false });
    expect(within(panel()!).queryByText('No label')).toBeNull();
    expect(
      within(panel()!).getByText('labeller@example.com', { exact: false }),
    ).toBeInTheDocument();
  });

  it("updates the header when the feed changes the row's annotations", async () => {
    const api = await renderGrid('feed', rows, []).api();
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(2));
    press(api, 'd');
    expect(within(panel()!).queryByText('feed@example.com', { exact: false })).toBeNull();

    await act(() =>
      getAnnotationStore().apply([annotated('c-1', 9, 'malicious', 'feed@example.com')], 'feed'),
    );
    expect(
      await within(panel()!).findByText('feed@example.com', { exact: false }),
    ).toBeInTheDocument();
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

describe('ActionResultsGrid Comment cell', () => {
  const BOB = 'bob@example.com';
  const ME = DEV_ACCOUNT.name;
  let patches: unknown[] = [];

  const commentedBy = (id: string, version: number, ...by: [string, string][]): Annotations => ({
    ...annotated(id, version, null),
    comments: by.map(([author, text]) => ({ author, at: '2026-10-21T10:00:00Z', text })),
  });

  beforeEach(() => {
    configureTestApp();
    patches = [];
    server.use(http.get(apiUrl('/api/columnViews'), () => HttpResponse.json([])));
    // jsdom lays nothing out: the grid places the editor's popup from the grid's offset parent,
    // and every 200 ms closes it when its cell has no size, as a cell scrolled away has.
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(() => document.body);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('ag-cell') ? new DOMRect(0, 0, 280, 30) : new DOMRect();
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetTestApp();
  });

  /** The grid with two rows of `id` and one of another, once the store has the annotations. */
  let gridApi: GridApi | undefined;

  async function commentGrid(id: string) {
    await getAnnotationStore().apply([commentedBy(id, 1, [BOB, 'beacons'])], 'feed');
    const shown = [
      { ...rows[0]!, id },
      { ...rows[1]!, id },
      { ...rows[0]!, row: 2, id: `${id}-other` },
    ];
    render(
      <AuthProvider client={createAuthClient({ VITE_AUTH_STUB: 'true' })}>
        <SnackbarHost>
          <ActionResultsGrid
            uuid={`comment-${id}`}
            action="dev.sign_ins"
            rows={shown}
            declaredColumns={[]}
            runColumns={columns}
            height={400}
            onGridReady={(e) => (gridApi = e.api)}
          />
        </SnackbarHost>
      </AuthProvider>,
    );
    // The grid can take over a second to start on a busy machine.
    await waitFor(() => expect(cellsOf()).toEqual(['bob: beacons', 'bob: beacons']), {
      timeout: 5000,
    });
    return userEvent.setup();
  }

  const cell = (row: number) =>
    document.querySelector<HTMLElement>(`[row-index="${row}"] [col-id="tim:comments"]`)!;
  /** The Comment cells of the two rows with the same id. */
  const cellsOf = () => [0, 1].map((row) => cell(row)?.textContent ?? '');
  const editor = (id: string) => screen.findByRole('textbox', { name: `Your comment on ${id}` });

  it("saves the comment with Enter, for that row's id only, and every row of it shows it", async () => {
    server.use(
      http.patch(apiUrl('/api/annotations'), async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json({
          changes: [commentedBy('e-1', 2, [BOB, 'beacons'], [ME, 'same tdC2\nevery 60s'])],
          version: 2,
        });
      }),
    );
    const user = await commentGrid('e-1');
    await user.dblClick(cell(0));
    await user.type(await editor('e-1'), 'same tdC2{Shift>}{Enter}{/Shift}every 60s');
    expect(screen.queryByRole('dialog', { name: /Annotate|Comment/ })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Row detail' })).toBeNull();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(patches).toEqual([{ ids: ['e-1'], comment: 'same tdC2\nevery 60s' }]),
    );
    const shown = 'same tdC2 ⏎ every 60s+1';
    await waitFor(() => expect(cellsOf()).toEqual([shown, shown]));
    expect(cell(2).textContent).toBe('');
  });

  it("keeps editing when a teammate's comment on the id comes in from the feed", async () => {
    server.use(
      http.patch(apiUrl('/api/annotations'), async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json({ changes: [], version: 3 });
      }),
    );
    const user = await commentGrid('e-5');
    await user.dblClick(cell(0));
    await user.type(await editor('e-5'), 'same');
    await act(() =>
      getAnnotationStore().apply(
        [commentedBy('e-5', 2, [BOB, 'beacons'], ['alice@example.com', 'seen it'])],
        'feed',
      ),
    );
    // Longer than the grid's 200 ms check on the popup.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await user.keyboard(' C2{Enter}');
    await waitFor(() => expect(patches).toEqual([{ ids: ['e-5'], comment: 'same C2' }]));
  });

  it('leaves the comments alone on Delete or paste over a range of Comment cells', async () => {
    server.use(
      http.patch(apiUrl('/api/annotations'), async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json({ changes: [], version: 1 });
      }),
    );
    await commentGrid('e-4');
    act(() => {
      gridApi!.addCellRange({ rowStartIndex: 0, rowEndIndex: 2, columns: ['tim:comments'] });
      cell(0).focus();
    });
    await userEvent.keyboard('{Delete}');
    act(() => {
      for (const row of [0, 1, 2]) {
        gridApi!.getDisplayedRowAtIndex(row)!.setDataValue('tim:comments', 'pasted', 'paste');
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(patches).toEqual([]);
    expect(cellsOf()).toEqual(['bob: beacons', 'bob: beacons']);
  });

  it("counts a teammate's comment from the feed, under your own", async () => {
    await commentGrid('e-3');
    await act(() =>
      getAnnotationStore().apply([commentedBy('e-3', 2, [BOB, 'beacons'], [ME, 'mine'])], 'own'),
    );
    await waitFor(() => expect(cellsOf()).toEqual(['mine+1', 'mine+1']));
    const alice = 'alice@example.com';
    await act(() =>
      getAnnotationStore().apply(
        [commentedBy('e-3', 3, [BOB, 'beacons'], [ME, 'mine'], [alice, 'seen it'])],
        'feed',
      ),
    );
    await waitFor(() => expect(cellsOf()).toEqual(['mine+2', 'mine+2']));
  });

  it('cancels with Esc, and keeps the old value with the reason when the save fails', async () => {
    server.use(
      http.patch(apiUrl('/api/annotations'), () =>
        problemResponse(503, { title: 'Unavailable', detail: 'Try again shortly' }),
      ),
    );
    const user = await commentGrid('e-2');
    await user.dblClick(cell(0));
    await user.type(await editor('e-2'), 'never sent');
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Your comment on e-2' })).toBeNull(),
    );
    act(() => cell(1).focus());
    await user.keyboard('{Enter}');
    await user.type(await editor('e-2'), 'refused');
    await user.keyboard('{Enter}');
    expect(
      await screen.findByText("Couldn't save the comment: Try again shortly"),
    ).toBeInTheDocument();
    expect(cellsOf()).toEqual(['bob: beacons', 'bob: beacons']);
  });
});
