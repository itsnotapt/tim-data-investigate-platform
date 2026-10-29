import { describe, expect, it } from 'vitest';
import type { GridState } from 'ag-grid-community';
import {
  fitColumnView,
  ignoredKeys,
  isModified,
  sameColumnView,
  columnViewStateOf,
} from './columnViewState';

/** What the grid reports for a result's Built-in view, after `resetColumnState()`. */
const base: GridState = {
  version: '36.2.0',
  columnOrder: {
    orderedColIds: ['ag-Grid-SelectionColumn', 'User', 'Host', 'Result', 'tim:label'],
  },
  columnVisibility: { hiddenColIds: ['Result', 'tim:label'] },
  columnPinning: { leftColIds: ['ag-Grid-SelectionColumn', 'Host'], rightColIds: [] },
  columnSizing: {
    columnSizingModel: [
      { colId: 'User', width: 200 },
      { colId: 'Host', width: 120 },
      { colId: 'Result', width: 90 },
      { colId: 'tim:label', width: 100 },
    ],
  },
  sort: { sortModel: [{ colId: 'Result', sort: 'desc' }] },
  scroll: { top: 40, left: 0 },
  rowSelection: ['1', '2'],
  sideBar: { visible: true, position: 'right', openToolPanel: 'columns', toolPanels: {} },
};

describe('columnViewStateOf', () => {
  it('keeps only the column and filter sections, marked partial', () => {
    const state: GridState = {
      ...base,
      filter: { filterModel: { User: { filterType: 'text', type: 'contains', filter: 'a' } } },
      focusedCell: { colId: 'User', rowIndex: 0, rowPinned: null },
      rowGroupExpansion: { expandedRowGroupIds: ['x'] },
      quickFilter: { text: 'abc' },
      columnHeaderName: {
        columnHeaderNames: [
          { colId: 'User', headerName: 'Who' },
          { colId: 'ag-Grid-AutoColumn', headerName: 'Group' },
        ],
      },
    };

    expect(columnViewStateOf(state)).toEqual({
      version: '36.2.0',
      partialColumnState: true,
      columnOrder: base.columnOrder,
      columnVisibility: base.columnVisibility,
      columnPinning: base.columnPinning,
      columnSizing: base.columnSizing,
      sort: base.sort,
      filter: state.filter,
      columnHeaderName: { columnHeaderNames: [{ colId: 'User', headerName: 'Who' }] },
      userColumns: [],
      rowGroup: { groupColIds: [] },
      aggregation: { aggregationModel: [] },
      pivot: { pivotMode: false, pivotColIds: [] },
    });
  });

  it('gives the sections the grid leaves out when empty their empty value', () => {
    expect(columnViewStateOf({ columnOrder: { orderedColIds: ['User'] } })).toEqual({
      partialColumnState: true,
      columnOrder: { orderedColIds: ['User'] },
      columnSizing: { columnSizingModel: [] },
      columnVisibility: { hiddenColIds: [] },
      columnPinning: { leftColIds: [], rightColIds: [] },
      columnHeaderName: { columnHeaderNames: [] },
      userColumns: [],
      sort: { sortModel: [] },
      rowGroup: { groupColIds: [] },
      aggregation: { aggregationModel: [] },
      pivot: { pivotMode: false, pivotColIds: [] },
      filter: { filterModel: {} },
    });
  });
});

describe('fitColumnView', () => {
  it('drops columns the result does not have', () => {
    const view = {
      partialColumnState: true,
      columnOrder: { orderedColIds: ['Gone', 'Host', 'User', 'Result', 'tim:label'] },
      columnVisibility: { hiddenColIds: ['Gone', 'User'] },
      columnPinning: { leftColIds: ['Gone'], rightColIds: ['Result'] },
      columnSizing: {
        columnSizingModel: [
          { colId: 'Gone', width: 50 },
          { colId: 'Host', width: 300 },
        ],
      },
      sort: {
        sortModel: [
          { colId: 'Gone', sort: 'asc' as const },
          { colId: 'User', sort: 'asc' as const },
        ],
      },
      rowGroup: { groupColIds: ['Gone', 'Host'] },
      aggregation: { aggregationModel: [{ colId: 'Gone', aggFunc: 'sum' }] },
      pivot: { pivotMode: false, pivotColIds: ['Gone'] },
      filter: { filterModel: { Gone: { filterType: 'text' }, Host: { filterType: 'text' } } },
      columnHeaderName: { columnHeaderNames: [{ colId: 'Gone', headerName: 'x' }] },
    };

    expect(fitColumnView(view, base)).toEqual({
      partialColumnState: true,
      columnOrder: {
        orderedColIds: ['Host', 'User', 'Result', 'tim:label', 'ag-Grid-SelectionColumn'],
      },
      columnVisibility: { hiddenColIds: ['User'] },
      columnPinning: { leftColIds: ['ag-Grid-SelectionColumn'], rightColIds: ['Result'] },
      columnSizing: { columnSizingModel: [{ colId: 'Host', width: 300 }] },
      sort: { sortModel: [{ colId: 'User', sort: 'asc' }] },
      rowGroup: { groupColIds: ['Host'] },
      aggregation: { aggregationModel: [] },
      pivot: { pivotMode: false, pivotColIds: [] },
      filter: { filterModel: { Host: { filterType: 'text' } } },
      columnHeaderName: { columnHeaderNames: [] },
    });
  });

  it('drops a number filter on the Comment column, which shows text, and keeps a text one', () => {
    const base = { columnOrder: { orderedColIds: ['User', 'tim:comments'] } };
    const filtered = (filter: object) => ({
      partialColumnState: true,
      filter: {
        filterModel: { User: { filterType: 'text' }, 'tim:comments': filter },
        columnFilterState: { User: { a: 1 }, 'tim:comments': { b: 2 } },
      },
    });
    const number = { filterType: 'number', type: 'greaterThan', filter: 0 };
    expect(fitColumnView(filtered(number), base).filter).toEqual({
      filterModel: { User: { filterType: 'text' } },
      columnFilterState: { User: { a: 1 } },
    });
    const text = { filterType: 'text', type: 'contains', filter: 'beacon' };
    expect(fitColumnView(filtered(text), base).filter).toEqual(filtered(text).filter);
  });

  it('appends the columns the view does not know, with their Built-in view', () => {
    // Saved on a result with only User and Host.
    const view = {
      partialColumnState: true,
      columnOrder: { orderedColIds: ['Host', 'User'] },
      columnVisibility: { hiddenColIds: [] },
      columnPinning: { leftColIds: [], rightColIds: ['User'] },
      columnSizing: {
        columnSizingModel: [
          { colId: 'User', width: 250 },
          { colId: 'Host', width: 80 },
        ],
      },
    };

    expect(fitColumnView(view, base)).toEqual({
      partialColumnState: true,
      columnOrder: {
        orderedColIds: ['Host', 'User', 'ag-Grid-SelectionColumn', 'Result', 'tim:label'],
      },
      columnVisibility: { hiddenColIds: ['Result', 'tim:label'] },
      columnPinning: { leftColIds: ['ag-Grid-SelectionColumn'], rightColIds: ['User'] },
      columnSizing: {
        columnSizingModel: [
          { colId: 'User', width: 250 },
          { colId: 'Host', width: 80 },
          { colId: 'Result', width: 90 },
          { colId: 'tim:label', width: 100 },
        ],
      },
    });
  });

  it("keeps the view's own calculated columns, and not the tab's", () => {
    const tabBase: GridState = {
      ...base,
      columnOrder: { orderedColIds: [...base.columnOrder!.orderedColIds, 'tabCalc'] },
      userColumns: [{ colId: 'tabCalc', created: true }],
    };
    const view = {
      partialColumnState: true,
      columnOrder: { orderedColIds: ['viewCalc', 'User'] },
      userColumns: [{ colId: 'viewCalc', created: true, properties: [] }],
    };

    expect(fitColumnView(view, tabBase).columnOrder).toEqual({
      orderedColIds: ['viewCalc', 'User', 'ag-Grid-SelectionColumn', 'Host', 'Result', 'tim:label'],
    });
    expect(fitColumnView(view, tabBase).userColumns).toEqual(view.userColumns);
  });

  it('leaves out the sections the view leaves out', () => {
    const view = { partialColumnState: true, filter: { filterModel: {} } };

    expect(fitColumnView(view, base)).toEqual(view);
  });
});

describe('ignoredKeys', () => {
  it('names every section setState should leave alone', () => {
    const ignored = ignoredKeys({
      partialColumnState: true,
      filter: { filterModel: {} },
      sort: { sortModel: [] },
    });

    expect(ignored).toContain('columnOrder');
    expect(ignored).toContain('scroll');
    expect(ignored).toContain('rowSelection');
    expect(ignored).toContain('sideBar');
    expect(ignored).not.toContain('filter');
    expect(ignored).not.toContain('sort');
  });
});

describe('sameColumnView', () => {
  it('ignores key order and the version', () => {
    expect(
      sameColumnView(
        {
          version: '36.1.0',
          sort: { sortModel: [] },
          filter: { filterModel: { a: { x: 1, y: 2 } } },
        },
        {
          filter: { filterModel: { a: { y: 2, x: 1 } } },
          sort: { sortModel: [] },
          version: '36.2.0',
        },
      ),
    ).toBe(true);
    expect(
      sameColumnView(
        { sort: { sortModel: [] } },
        { sort: { sortModel: [{ colId: 'a', sort: 'asc' }] } },
      ),
    ).toBe(false);
  });
});

describe('isModified', () => {
  // Applied on a result with only User and Host.
  const baseline = {
    version: '36.2.0',
    partialColumnState: true,
    columnOrder: { orderedColIds: ['ag-Grid-SelectionColumn', 'Host', 'User'] },
    columnVisibility: { hiddenColIds: [] },
    columnSizing: {
      columnSizingModel: [
        { colId: 'User', width: 250 },
        { colId: 'Host', width: 80 },
      ],
    },
    filter: { filterModel: {} },
  };
  // The same column view on a wider result, as the grid reports it.
  const current = {
    version: '36.2.0',
    partialColumnState: true,
    columnOrder: {
      orderedColIds: ['ag-Grid-SelectionColumn', 'Host', 'User', 'Result', 'tim:label'],
    },
    columnVisibility: { hiddenColIds: ['Result', 'tim:label'] },
    columnSizing: {
      columnSizingModel: [
        { colId: 'User', width: 250 },
        { colId: 'Host', width: 80 },
        { colId: 'Result', width: 90 },
        { colId: 'tim:label', width: 100 },
      ],
    },
    filter: { filterModel: {} },
  };

  it('is not modified by the columns the view did not know', () => {
    expect(isModified(baseline, current)).toBe(false);
  });

  it('is modified by a change to a column the view knows', () => {
    const hidden = {
      ...current,
      columnVisibility: { hiddenColIds: ['User', 'Result', 'tim:label'] },
    };
    expect(isModified(baseline, hidden)).toBe(true);
  });

  it("is modified by the tab's own calculated column", () => {
    const calc = {
      ...current,
      columnOrder: { orderedColIds: [...current.columnOrder.orderedColIds, 'calc'] },
      userColumns: [{ colId: 'calc', created: true }],
    };
    expect(isModified(baseline, calc)).toBe(true);
  });

  it('is modified by a filter', () => {
    const filtered = { ...current, filter: { filterModel: { User: { filterType: 'text' } } } };
    expect(isModified(baseline, filtered)).toBe(true);
  });
});
