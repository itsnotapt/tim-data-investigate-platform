import 'fake-indexeddb/auto';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnState, GridApi, MenuItemDef } from 'ag-grid-community';
import { load } from 'js-yaml';
import { HttpResponse, http } from 'msw';
import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type {
  Annotations,
  CatalogueAction,
  CatalogueColumn,
  RunColumn,
  RunRow,
} from '../../lib/api';
import { AuthProvider, createAuthClient, DEV_ACCOUNT } from '../../lib/auth';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { SnackbarHost } from '../../components/SnackbarHost';
import { getAnnotationStore } from '../../lib/annotations';
import { annotated } from '../../test/annotationFakes';
import { useActionPivotMenu } from '../action-pivots';
import { useAnalystStore } from '../analyst';
import { useInstanceStore } from '../instance';
import type { LabelledRow } from '../labels';
import { content } from '../../test/tabsTestUtils';
import { useTabsStore } from '../tabs';
import { gridStateChanged } from './model';
import { ActionResultsGrid, type ActionResultsGridProps } from './ActionResultsGrid';
import { clearResults, pageLoaded, runLoading, useResults } from './results';

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
    data: {
      CaseId: 'c-1',
      Timestamp: '2026-10-01T08:00:00Z',
      User: 'alice',
      Raw: {},
      row: 'first',
      'Raw Bytes': 2048,
    },
  },
  {
    row: 1,
    data: {
      CaseId: 'c-1',
      Timestamp: '2026-10-01T08:05:00Z',
      User: 'bob',
      Raw: {},
      row: 'second',
      'Raw Bytes': 512,
    },
  },
];

/** The data column the grids below take their ids from; no run column shows it. */
const ID_COLUMN = 'CaseId';
const withId = (row: RunRow, id: string): RunRow => ({
  ...row,
  data: { ...row.data, [ID_COLUMN]: id },
});

const RUN_ID = 'r1';

/**
 * The tab `name` (a new one named so, unless a tab has that id), with `shown` as the first page of
 * its run's rows. More pages can follow, with `pageLoaded`.
 */
function loadingTab(
  name: string,
  shown: readonly RunRow[],
  runColumns: RunColumn[] = columns,
  idColumn: string | null = ID_COLUMN,
): string {
  const tabId =
    name in useTabsStore.getState().tabs
      ? name
      : useTabsStore.getState().createTab({ parentId: null, content: content(name) });
  runLoading(tabId, { runId: RUN_ID, columns: runColumns, rowCount: shown.length }, idColumn);
  pageLoaded(tabId, RUN_ID, shown);
  return tabId;
}

type TabGridProps = Omit<ActionResultsGridProps, 'results'> & { idColumn?: string | null };

/** The grid of the tab's Results, as the action tab shows it. */
function TabGrid({ tabId, idColumn = ID_COLUMN, ...props }: TabGridProps) {
  const results = useResults(tabId, { idColumn, stored: null });
  return (
    results && <ActionResultsGrid key={results.runId} tabId={tabId} results={results} {...props} />
  );
}

function renderGrid(
  name: string,
  shown: readonly RunRow[] = rows,
  declaredColumns: readonly CatalogueColumn[] = declared,
) {
  let api: GridApi | undefined;
  const tabId = loadingTab(name, shown);
  render(
    <TabGrid
      tabId={tabId}
      declaredColumns={declaredColumns}
      height={400}
      onGridReady={(e) => (api = e.api)}
    />,
  );
  return {
    api: async () => {
      await waitFor(() => expect(api).toBeDefined());
      return api!;
    },
    /** The next page of the tab's run arrives. */
    page: (page: readonly RunRow[]) => act(() => pageLoaded(tabId, RUN_ID, page)),
  };
}

async function gridOf(tabId: string, declaredColumns?: readonly CatalogueColumn[]) {
  const api = await renderGrid(tabId, rows, declaredColumns).api();
  await waitFor(() => expect(api.getDisplayedRowCount()).toBeGreaterThan(0));
  return api;
}

const stateOf = (api: GridApi, colId: string): ColumnState | undefined =>
  api.getColumnState().find((c) => c.colId === colId);

let clipboard: string | null;

beforeEach(() => {
  useTabsStore.reset();
  clearResults();
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
    const tabId = useTabsStore
      .getState()
      .createTab({ parentId: null, content: content('Sign-ins') });
    useTabsStore.getState().apply(
      tabId,
      gridStateChanged({
        partialColumnState: true,
        columnOrder: { orderedColIds: ['Timestamp', 'User', 'Raw', 'KiB', 'row', 'Raw Bytes'] },
        columnVisibility: { hiddenColIds: [] },
        columnPinning: { leftColIds: [], rightColIds: [] },
        columnSizing: { columnSizingModel: [{ colId: 'Timestamp', width: 90 }] },
        sort: { sortModel: [] },
      }),
    );
    const api = await gridOf(tabId);
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

  it('adds the rows of each page that arrives, keeping the selection', async () => {
    const grid = renderGrid('growing', rows.slice(0, 1));
    const api = await grid.api();
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(1));
    act(() => api.getRowNode('0')!.setSelected(true));
    grid.page(rows.slice(1));
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(2));
    expect(api.getCellValue({ rowNode: api.getRowNode('1')!, colKey: 'User' })).toBe('bob');
    expect(api.getSelectedNodes().map((n) => n.id)).toEqual(['0']);
  });

  it('flashes the rows a change from the feed labels, and not those of the analyst’s own', async () => {
    const shown = [withId(rows[0]!, 'flash-feed'), withId(rows[1]!, 'flash-own')];
    const api = await renderGrid('flash', shown, []).api();
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(2));
    const flashing = (row: number) =>
      document.querySelectorAll(`[row-index="${row}"] .ag-cell-data-changed`).length > 0;
    const labelOf = (row: string) =>
      (api.getRowNode(row)?.data as LabelledRow | undefined)?.annotations?.label?.key;

    await act(() => getAnnotationStore().apply([annotated('flash-own', 1, 'benign')], 'own'));
    await waitFor(() => expect(labelOf('1')).toBe('benign'));
    expect(flashing(1)).toBe(false);

    await act(() => getAnnotationStore().apply([annotated('flash-feed', 1, 'malicious')], 'feed'));
    await waitFor(() => expect(labelOf('0')).toBe('malicious'));
    expect(flashing(0)).toBe(true);
    expect(flashing(1)).toBe(false);
  });

  it('focuses the linked row and opens its Row detail once the row has arrived', async () => {
    const shown = vi.fn();
    let api: GridApi | undefined;
    const tabId = loadingTab('linked', rows.slice(0, 1));
    render(
      <TabGrid
        tabId={tabId}
        declaredColumns={declared}
        height={400}
        linkedRow={1}
        onLinkedRowShown={shown}
        onGridReady={(e) => (api = e.api)}
      />,
    );
    await waitFor(() => expect(api?.getDisplayedRowCount()).toBeGreaterThan(0));
    expect(screen.queryByRole('complementary', { name: 'Row detail' })).not.toBeInTheDocument();
    expect(shown).not.toHaveBeenCalled();

    act(() => pageLoaded(tabId, RUN_ID, rows.slice(1)));
    const detail = await screen.findByRole('complementary', { name: 'Row detail' });
    // The id shows in the header and, being a data column, among the fields.
    expect(within(detail).getAllByText('c-1').length).toBeGreaterThan(0);
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
        <TabGrid
          tabId={loadingTab('link', rows, columns, null)}
          idColumn={null}
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

describe('ActionResultsGrid Go to pivot row', () => {
  /** Events in time order; e-2 shows twice, and the pivot rows below look for it. */
  const events: RunRow[] = ['e-1', 'e-2', 'e-3', 'e-2'].map((id, row) => ({
    row,
    data: { [ID_COLUMN]: id, User: `user-${row}` },
  }));

  function renderPivoted({
    pivotRowIds = ['e-3'] as (string | null)[] | null,
    findPivotRows = true,
    shown = events,
    declaredColumns = null as CatalogueColumn[] | null,
  } = {}) {
    let api: GridApi | undefined;
    render(
      <TabGrid
        tabId={loadingTab('pivoted', shown, [
          { name: 'User', type: 'string', declared: !!declaredColumns },
        ])}
        declaredColumns={declaredColumns}
        pivotRowIds={pivotRowIds}
        findPivotRows={findPivotRows}
        height={400}
        onGridReady={(e) => (api = e.api)}
      />,
    );
    return async () => {
      await waitFor(() => expect(api?.getDisplayedRowCount()).toBeGreaterThan(0));
      return api!;
    };
  }

  const link = () => screen.queryByRole('button', { name: /^Go to pivot row/ });

  it('shows the link only on a tab with pivot rows, into an action that finds them', async () => {
    await renderPivoted({ pivotRowIds: null })();
    expect(link()).not.toBeInTheDocument();
  });

  it("shows no link when the action doesn't find pivot rows", async () => {
    await renderPivoted({ findPivotRows: false })();
    expect(link()).not.toBeInTheDocument();
  });

  const focusedRow = (api: GridApi) => {
    const focused = api.getFocusedCell();
    return focused ? api.getDisplayedRowAtIndex(focused.rowIndex)?.id : undefined;
  };

  it('focuses and flashes the matching row, and leaves the selection alone', async () => {
    const api = await renderPivoted()();
    act(() => api.getRowNode('0')!.setSelected(true));

    await waitFor(() => expect(link()).toBeEnabled());
    await userEvent.click(link()!);

    expect(focusedRow(api)).toBe('2');
    expect(document.querySelector('.ag-row[row-id="2"] .ag-cell-data-changed')).not.toBeNull();
    expect(api.getSelectedNodes().map((n) => n.id)).toEqual(['0']);
    expect(screen.queryByRole('complementary', { name: 'Row detail' })).not.toBeInTheDocument();
    expect(link()).toHaveAccessibleName('Go to pivot row');
  });

  it('goes through the matching rows in grid order, counting them, and wraps', async () => {
    const api = await renderPivoted({ pivotRowIds: ['e-2'] })();
    await waitFor(() => expect(link()).toBeEnabled());
    expect(link()).toHaveAccessibleName('Go to pivot row');

    await userEvent.click(link()!);
    expect(focusedRow(api)).toBe('1');
    expect(link()).toHaveAccessibleName('Go to pivot row (1 of 2)');

    await userEvent.click(link()!);
    expect(focusedRow(api)).toBe('3');
    expect(link()).toHaveAccessibleName('Go to pivot row (2 of 2)');

    await userEvent.click(link()!);
    expect(focusedRow(api)).toBe('1');
    expect(link()).toHaveAccessibleName('Go to pivot row (1 of 2)');
  });

  it("opens the matching row's group", async () => {
    const api = await renderPivoted({
      declaredColumns: [{ name: 'User', type: 'string', hidden: false, group: true }],
    })();
    expect(api.getRowNode('2')!.parent!.expanded).toBe(false);
    await waitFor(() => expect(link()).toBeEnabled());

    await userEvent.click(link()!);

    expect(api.getRowNode('2')!.parent!.expanded).toBe(true);
    expect(focusedRow(api)).toBe('2');
  });

  it('goes through the matching rows in the order the grid sorts them', async () => {
    const api = await renderPivoted({ pivotRowIds: ['e-2'] })();
    act(() => void api.applyColumnState({ state: [{ colId: 'User', sort: 'desc' }] }));
    await waitFor(() => expect(link()).toBeEnabled());

    await userEvent.click(link()!);
    expect(focusedRow(api)).toBe('3');
  });

  /** The tooltip the disabled link shows on hover, if any. */
  async function disabledTooltip() {
    await waitFor(() => expect(link()).toBeDisabled());
    await userEvent.hover(link()!.parentElement!);
    return screen.findByRole('tooltip').then(
      (t) => t.textContent,
      () => null,
    );
  }

  it.each([
    ['no id', [null, null], 'The pivot rows have no id.'],
    ['no row with the id', ['e-9', null], "No row here has a pivot row's id."],
  ])('is disabled when the pivot rows have %s, and says why', async (_, pivotRowIds, reason) => {
    await renderPivoted({ pivotRowIds })();
    expect(await disabledTooltip()).toBe(reason);
  });

  it('is disabled when the filters hide every matching row, and says why', async () => {
    const api = await renderPivoted()();
    await act(async () => {
      await api.setColumnFilterModel('User', {
        filterType: 'multi',
        filterModels: [{ filterType: 'text', type: 'notEqual', filter: 'user-2' }],
      });
      api.onFilterChanged();
    });
    expect(await disabledTooltip()).toBe("The pivot row is hidden by the grid's filters.");
  });

  it('is disabled with no reason until the rows arrive', async () => {
    renderPivoted({ shown: [] });
    await waitFor(() => expect(link()).toBeInTheDocument());
    expect(await disabledTooltip()).toBeNull();
  });

  it('skips a matching row the filters hide', async () => {
    const api = await renderPivoted({ pivotRowIds: ['e-2'] })();
    await act(async () => {
      await api.setColumnFilterModel('User', {
        filterType: 'multi',
        filterModels: [{ filterType: 'text', type: 'notEqual', filter: 'user-1' }],
      });
      api.onFilterChanged();
    });
    await waitFor(() => expect(api.getDisplayedRowCount()).toBe(3));

    await userEvent.click(link()!);
    expect(focusedRow(api)).toBe('3');
    await userEvent.click(link()!);
    expect(focusedRow(api)).toBe('3');
    expect(link()).toHaveAccessibleName('Go to pivot row');
  });
});

describe('ActionResultsGrid Row detail', () => {
  const idless: RunRow[] = [
    { row: 0, data: { User: 'alice', Host: 'h1' } },
    { row: 1, data: { User: 'bob', Host: 'h2' } },
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
    expect(terms()).toEqual(['Timestamp', 'User', 'row', 'Raw Bytes', ID_COLUMN]);
    expect(within(panel()!).getByText('alice')).toBeInTheDocument();

    act(() => api.moveColumns(['Raw Bytes'], 0));
    act(() => api.setFocusedCell(1, 'User'));
    expect(await within(panel()!).findByText('row 1', { exact: false })).toBeInTheDocument();
    expect(within(panel()!).getByText('bob')).toBeInTheDocument();
    expect(terms()).toEqual(['Timestamp', 'User', 'row', 'Raw Bytes', ID_COLUMN]);
  });

  it("keeps a row's comment draft while the focus moves, and drops it on close", async () => {
    const user = userEvent.setup();
    const shown = [rows[0]!, withId(rows[1]!, 'c-2')];
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
    const shown = [withId(rows[0]!, 'f-1'), withId(rows[1]!, 'f-2')];
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

describe('ActionResultsGrid Id column', () => {
  const sessions: RunRow[] = [
    { row: 0, data: { User: 'switch-alice', Host: 'switch-h1' } },
    { row: 1, data: { User: 'switch-bob', Host: 'switch-h1' } },
    { row: 2, data: { User: 'switch-alice', Host: 'switch-h2' } },
  ];
  const labelsOf = (api: GridApi) =>
    ['0', '1', '2'].map(
      (row) =>
        (api.getRowNode(row)?.data as LabelledRow | undefined)?.annotations?.label?.key ?? null,
    );
  const switchable = () =>
    loadingTab(
      'id-column',
      sessions,
      [
        { name: 'User', type: 'string', declared: false },
        { name: 'Host', type: 'string', declared: false },
      ],
      'User',
    );
  /** Picks `name` from the menu of row 1's `column` cell. */
  const pick = (api: GridApi, column: string, name: string) => {
    const items = (api.getGridOption('getContextMenuItems') as (p: unknown) => Item[])({
      api,
      node: api.getRowNode('1'),
      column: api.getColumn(column),
    });
    const item = find(items, name);
    expect(item).toBeDefined();
    act(() => (item!.action as () => void)());
  };

  let api: GridApi | undefined;
  function Switchable({ tabId }: { tabId: string }) {
    const [idColumn, setIdColumn] = useState<string | null>('User');
    return (
      <TabGrid
        tabId={tabId}
        idColumn={idColumn}
        onIdColumnChange={setIdColumn}
        height={400}
        onGridReady={(e) => (api = e.api)}
      />
    );
  }

  it("switches from a cell's menu: the rows show their new ids' annotations, keep the selection, and get the old ones back on switching back", async () => {
    await getAnnotationStore().apply(
      [annotated('switch-alice', 1, 'malicious'), annotated('switch-h1', 1, 'benign')],
      'feed',
    );
    render(<Switchable tabId={switchable()} />);
    await waitFor(() => expect(labelsOf(api!)).toEqual(['malicious', null, 'malicious']));
    act(() => api!.getRowNode('1')!.setSelected(true));

    pick(api!, 'Host', 'Use Host as Id column');
    await waitFor(() => expect(labelsOf(api!)).toEqual(['benign', 'benign', null]));
    expect(api!.getSelectedNodes().map((n) => n.id)).toEqual(['1']);

    pick(api!, 'User', 'Use User as Id column');
    await waitFor(() => expect(labelsOf(api!)).toEqual(['malicious', null, 'malicious']));
    expect(api!.getSelectedNodes().map((n) => n.id)).toEqual(['1']);
  });

  it('redraws the label symbol of a row whose new id has no annotations', async () => {
    useInstanceStore.setState({
      instance: {
        version: 'v1',
        actions: [],
        connections: [],
        labels: [
          { key: 'malicious', name: 'Malicious', colour: 'red', symbol: 'skull' },
          { key: 'benign', name: 'Benign', colour: 'green', symbol: 'check' },
        ],
        limits: {
          maxResultRows: 1,
          maxResultBytes: 1,
          maxPivotRows: 100,
          rowsPageSize: 1,
          runTimeoutSeconds: 1,
          maxAnnotationIds: 10_000,
          annotationPollSeconds: 30,
        },
      },
    });
    onTestFinished(() => useInstanceStore.setState({ instance: null }));
    await getAnnotationStore().apply(
      [annotated('switch-alice', 1, 'malicious'), annotated('switch-h1', 1, 'benign')],
      'feed',
    );
    render(<Switchable tabId={switchable()} />);
    const symbolOf = (row: string) =>
      document.querySelector<HTMLElement>(
        `.ag-row[row-id="${row}"] [col-id="ag-Grid-SelectionColumn"] [role="img"]`,
      );
    await waitFor(() => expect(symbolOf('2')).not.toBeNull());

    pick(api!, 'Host', 'Use Host as Id column');
    await waitFor(() => expect(labelsOf(api!)).toEqual(['benign', 'benign', null]));
    await waitFor(() => expect(symbolOf('1')).not.toBeNull());
    expect(symbolOf('2')).toBeNull();
  });

  it('shows the new id in an open Row detail', async () => {
    render(<Switchable tabId={switchable()} />);
    await waitFor(() => expect(api?.getDisplayedRowCount()).toBe(3));
    const rowDetail = find(
      (api!.getGridOption('getContextMenuItems') as (p: unknown) => Item[])({
        api,
        node: api!.getRowNode('1'),
        column: api!.getColumn('User'),
      }),
      'Row detail',
    );
    act(() => (rowDetail!.action as () => void)());
    const detail = await screen.findByRole('complementary', { name: 'Row detail' });
    const shownId = () => detail.querySelector('code')?.textContent;
    expect(shownId()).toBe('switch-bob');

    pick(api!, 'Host', 'Use Host as Id column');
    await waitFor(() => expect(shownId()).toBe('switch-h1'));
  });
});

describe('ActionResultsGrid acting after the Id column changes', () => {
  const sessions: RunRow[] = [
    { row: 0, data: { User: 'acting-alice', Host: 'acting-h1' } },
    { row: 1, data: { User: 'acting-bob', Host: 'acting-h1' } },
    { row: 2, data: { User: 'acting-carol', Host: 'acting-h2' } },
  ];
  let patches: unknown[];
  let api: GridApi | undefined;

  function Switchable({ tabId, ...props }: Omit<TabGridProps, 'idColumn'>) {
    const [idColumn, setIdColumn] = useState<string | null>('User');
    return (
      <TabGrid
        tabId={tabId}
        idColumn={idColumn}
        onIdColumnChange={setIdColumn}
        height={400}
        onGridReady={(e) => (api = e.api)}
        {...props}
      />
    );
  }

  const SINK: CatalogueAction = {
    key: 'case',
    kind: 'sink',
    actionFile: false,
    findPivotRows: false,
    name: 'Add to case',
    menuPath: [],
    connections: [],
    params: [],
    pivot: { rows: 'rows', columns: [] },
  };
  const BY_HOST: CatalogueAction = {
    key: 'by-host',
    kind: 'query',
    actionFile: false,
    findPivotRows: true,
    name: 'Sign-ins by host',
    menuPath: [],
    connections: [],
    params: [
      {
        name: 'hosts',
        title: 'Hosts',
        kind: 'string',
        required: true,
        many: true,
        fromColumns: ['Host'],
      },
    ],
    pivot: { rows: 'rows', columns: [['Host']] },
  };

  /** The item named `name` anywhere in `items` and their submenus. */
  const deepFind = (items: Item[], name: string): MenuItemDef | undefined => {
    for (const item of items) {
      if (typeof item !== 'object') continue;
      if (item.name === name) return item;
      const found = item.subMenu && deepFind(item.subMenu as Item[], name);
      if (found) return found;
    }
    return undefined;
  };
  const pickFrom = (items: Item[], name: string) => {
    const item = deepFind(items, name);
    expect(item).toBeDefined();
    act(() => (item!.action as () => void)());
  };

  beforeEach(() => {
    configureTestApp();
    useInstanceStore.setState({
      instance: {
        version: 'v1',
        actions: [SINK, BY_HOST],
        connections: [],
        labels: [],
        limits: {
          maxResultRows: 1,
          maxResultBytes: 1,
          maxPivotRows: 100,
          rowsPageSize: 1,
          runTimeoutSeconds: 1,
          maxAnnotationIds: 10_000,
          annotationPollSeconds: 30,
        },
      },
    });
    patches = [];
    server.use(
      http.patch(apiUrl('/api/annotations'), async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json({ changes: [], version: 1 });
      }),
    );
  });
  afterEach(() => {
    useInstanceStore.setState({ instance: null });
    resetTestApp();
  });

  /** The menu of row 1's `column` cell. */
  const menuOf = (column: string) =>
    (api!.getGridOption('getContextMenuItems') as (p: unknown) => Item[])({
      api,
      node: api!.getRowNode('1'),
      column: api!.getColumn(column),
    });

  /**
   * The grid with rows 0 and 1 selected, keyed by User; returns the menu of row 1's User cell,
   * opened before the Id column switches to Host.
   */
  async function menuThenSwitch(
    wrap: (grid: (props: Partial<TabGridProps>) => ReactNode, tabId: string) => ReactNode = (
      grid,
    ) => grid({}),
  ): Promise<Item[]> {
    const tabId = loadingTab(
      'acting',
      sessions,
      [
        { name: 'User', type: 'string', declared: false },
        { name: 'Host', type: 'string', declared: false },
      ],
      'User',
    );
    render(
      <SnackbarHost>
        {wrap(
          (props) => (
            <Switchable tabId={tabId} {...props} />
          ),
          tabId,
        )}
      </SnackbarHost>,
    );
    await waitFor(() => expect(api?.getDisplayedRowCount()).toBe(3));
    act(() =>
      api!.setNodesSelected({
        nodes: [api!.getRowNode('0')!, api!.getRowNode('1')!],
        newValue: true,
      }),
    );
    const items = menuOf('User');
    const useHost = find(menuOf('Host'), 'Use Host as Id column');
    act(() => (useHost!.action as () => void)());
    return items;
  }

  it("Label ▸ labels the rows' ids as they are when it acts", async () => {
    const items = await menuThenSwitch();
    const clear = find(find(items, 'Label')!.subMenu as Item[], 'Clear label');
    act(() => (clear!.action as () => void)());
    await waitFor(() => expect(patches).toEqual([{ ids: ['acting-h1'], label: null }]));
  });

  it.each(['Annotate', 'Comment'])(
    "%s… opens on the rows' ids as they are when it acts",
    async (mode) => {
      pickFrom(await menuThenSwitch(), `${mode}…`);
      const dialog = await screen.findByRole('dialog', { name: mode });
      expect(within(dialog).getByText('2 rows · 1 id', { exact: false })).toBeInTheDocument();
    },
  );

  it('runs a sink on the rows as they are when it acts', async () => {
    const runs: unknown[] = [];
    server.use(
      http.post(apiUrl('/api/runs'), async ({ request }) => {
        runs.push(await request.json());
        return problemResponse(503);
      }),
    );
    pickFrom(await menuThenSwitch(), 'Add to case');
    await waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0]).toMatchObject({
      action: 'case',
      input: { rows: [sessions[0]!.data, sessions[1]!.data] },
    });
  });

  it("pivots with the rows' ids as they are when it acts", async () => {
    server.use(
      http.get(apiUrl('/api/presets'), () => HttpResponse.json([])),
      http.post(apiUrl('/api/actions/by-host/resolve'), () =>
        HttpResponse.json({ params: { hosts: ['acting-h1'] }, missing: [], reasons: {} }),
      ),
    );
    let parent = '';
    function Pivoting({ grid }: { grid: (props: Partial<TabGridProps>) => ReactNode }) {
      const pivotMenu = useActionPivotMenu(parent, () => undefined);
      return grid({ getContextMenuItems: pivotMenu });
    }
    const items = await menuThenSwitch((grid, tabId) => {
      parent = tabId;
      return (
        <MemoryRouter>
          <Pivoting grid={grid} />
        </MemoryRouter>
      );
    });
    pickFrom(items, 'Sign-ins by host');
    await waitFor(() => {
      const child = Object.values(useTabsStore.getState().tabs).find((t) => t.parentId === parent);
      expect(child).toMatchObject({ toRun: { pivotRowIds: ['acting-h1', 'acting-h1'] } });
    });
  });
});

describe('ActionResultsGrid with a bigint column', () => {
  async function bigGrid(tabId: string, shown: readonly RunRow[], runColumns: RunColumn[]) {
    let api: GridApi | undefined;
    render(
      <TabGrid
        tabId={loadingTab(tabId, shown, runColumns, null)}
        idColumn={null}
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

  const hashes: RunRow[] = [
    { row: 0, data: { Hash: '12345678901234567890' } },
    { row: 1, data: { Hash: '5' } },
    { row: 2, data: { Hash: '-9007199254740993' } },
    { row: 3, data: { Hash: null } },
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

describe('ActionResultsGrid Comment cell', () => {
  const BOB = 'bob@example.com';
  const ME = DEV_ACCOUNT.name;
  let patches: unknown[] = [];

  const commentedBy = (id: string, version: number, ...by: [string, string][]): Annotations => ({
    ...annotated(id, version, null),
    comments: by.map(([author, text]) => ({ author, at: '2026-10-21T10:00:00Z', text })),
  });

  /** Signs in as the analyst the API knows by `name`. */
  async function knownAs(name: string) {
    server.use(http.get(apiUrl('/api/me'), () => HttpResponse.json({ name })));
    await useAnalystStore.getState().load();
  }

  beforeEach(async () => {
    configureTestApp();
    patches = [];
    server.use(http.get(apiUrl('/api/columnViews'), () => HttpResponse.json([])));
    await knownAs(ME);
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
    useAnalystStore.reset();
    resetTestApp();
  });

  /** The grid with two rows of `id` and one of another, once the store has the annotations. */
  let gridApi: GridApi | undefined;

  async function commentGrid(id: string) {
    await getAnnotationStore().apply([commentedBy(id, 1, [BOB, 'beacons'])], 'feed');
    const shown = [
      withId(rows[0]!, id),
      withId(rows[1]!, id),
      { ...withId(rows[0]!, `${id}-other`), row: 2 },
    ];
    render(
      <AuthProvider client={createAuthClient({ VITE_AUTH_STUB: 'true' })}>
        <SnackbarHost>
          <TabGrid
            tabId={loadingTab(`comment-${id}`, shown)}
            declaredColumns={[]}
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

  describe('for an analyst the API knows by another name than their sign-in', () => {
    const KNOWN = `live.com#${ME}`;

    beforeEach(() => knownAs(KNOWN));

    it('shows their comment as theirs', async () => {
      await commentGrid('e-6');
      await act(() =>
        getAnnotationStore().apply(
          [commentedBy('e-6', 2, [BOB, 'beacons'], [KNOWN, 'mine'])],
          'feed',
        ),
      );
      await waitFor(() => expect(cellsOf()).toEqual(['mine+1', 'mine+1']));
    });

    it('keeps their saved comment in the Row detail box, apart from the other comments', async () => {
      server.use(
        http.get(apiUrl('/api/annotations/history'), () =>
          HttpResponse.json({ id: 'e-7', entries: [] }),
        ),
        http.patch(apiUrl('/api/annotations'), () =>
          HttpResponse.json({
            changes: [commentedBy('e-7', 2, [BOB, 'beacons'], [KNOWN, 'mine'])],
            version: 2,
          }),
        ),
      );
      const user = await commentGrid('e-7');
      const items = (gridApi!.getGridOption('getContextMenuItems') as (p: unknown) => Item[])({
        api: gridApi,
        node: gridApi!.getRowNode('0'),
        column: gridApi!.getColumn('User'),
      });
      act(() => find(items, 'Row detail')!.action!({} as never));
      const detail = await screen.findByRole('complementary', { name: 'Row detail' });

      await user.type(within(detail).getByLabelText('Comment'), 'mine');
      await user.click(within(detail).getByRole('button', { name: 'Save' }));

      await within(detail).findByRole('button', { name: 'Delete comment' });
      expect(within(detail).getByLabelText('Comment')).toHaveValue('mine');
      const others = within(detail).getByRole('list', { name: 'Other comments' });
      expect(
        within(others)
          .getAllByRole('listitem')
          .map((li) => li.textContent),
      ).toEqual([expect.stringContaining('beacons')]);
    });
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
