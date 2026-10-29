import type { ColDef, GridState } from 'ag-grid-community';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import type { CatalogueColumn, RunColumn } from '../../lib/api';
import { actionFileColumns } from './actionFileColumns';

const runColumns: RunColumn[] = [
  { name: 'Timestamp', type: 'datetime', declared: true },
  { name: 'User', type: 'string', declared: true },
  { name: 'Bytes', type: 'number', declared: false },
];

/** TIM's own columns, with their defaults. */
const own: ColDef[] = [
  { colId: 'tim:comments', headerName: 'Comment', width: 280 },
  { colId: 'tim:tags', headerName: 'Tags', initialHide: true },
  { colId: 'tim:label', headerName: 'Label', initialHide: true },
];

/** The grid's state for `runColumns` with nothing changed. */
const untouched: GridState = {
  columnOrder: {
    orderedColIds: [
      'ag-Grid-SelectionColumn',
      'Timestamp',
      'User',
      'Bytes',
      'tim:comments',
      'tim:tags',
      'tim:label',
    ],
  },
  columnVisibility: { hiddenColIds: ['tim:tags', 'tim:label'] },
  columnPinning: { leftColIds: ['ag-Grid-SelectionColumn'], rightColIds: [] },
  columnSizing: {
    columnSizingModel: [
      { colId: 'ag-Grid-SelectionColumn', width: 50 },
      { colId: 'Timestamp', width: 200 },
      { colId: 'User', width: 200 },
      { colId: 'Bytes', width: 200 },
      { colId: 'tim:comments', width: 280 },
      { colId: 'tim:tags', width: 200 },
      { colId: 'tim:label', width: 200 },
    ],
  },
};

function columnsOf(state: GridState, declared: CatalogueColumn[] = []) {
  const text = actionFileColumns({ state, declared, runColumns, own });
  return (load(text) as { columns: unknown[] }).columns;
}

describe('actionFileColumns', () => {
  it("gives each column's name, type, header, visibility, pinning, width, sort and group, in grid order", () => {
    const state: GridState = {
      ...untouched,
      columnOrder: {
        orderedColIds: [
          'ag-Grid-SelectionColumn',
          'User',
          'Timestamp',
          'Bytes',
          'tim:comments',
          'tim:tags',
          'tim:label',
        ],
      },
      columnVisibility: { hiddenColIds: ['Bytes', 'tim:tags', 'tim:label'] },
      columnPinning: { leftColIds: ['ag-Grid-SelectionColumn', 'Timestamp'], rightColIds: [] },
      columnSizing: {
        columnSizingModel: untouched.columnSizing!.columnSizingModel.map((s) =>
          s.colId === 'Timestamp' ? { ...s, width: 160 } : s,
        ),
      },
      columnHeaderName: { columnHeaderNames: [{ colId: 'User', headerName: 'Analyst' }] },
      sort: { sortModel: [{ colId: 'Timestamp', sort: 'desc' }] },
      rowGroup: { groupColIds: ['User'] },
      filter: { filterModel: { User: { filterType: 'text', type: 'contains', filter: 'a' } } },
    };
    expect(actionFileColumns({ state, declared: [], runColumns, own })).toBe(
      [
        'columns:',
        '  - name: User',
        '    type: string',
        '    title: Analyst',
        '    group: true',
        '  - name: Timestamp',
        '    type: datetime',
        '    width: 160',
        '    pinned: left',
        '    sort: desc',
        '  - name: Bytes',
        '    type: number',
        '    hidden: true',
        '',
      ].join('\n'),
    );
  });

  it("keeps a declared column's title and a declared calculated column's expression", () => {
    const state: GridState = {
      ...untouched,
      columnOrder: {
        orderedColIds: [
          'Timestamp',
          'User',
          'Bytes',
          'KiB',
          'tim:comments',
          'tim:tags',
          'tim:label',
        ],
      },
    };
    const declared: CatalogueColumn[] = [
      { name: 'User', type: 'string', title: 'Analyst', hidden: false, group: false },
      {
        name: 'KiB',
        type: 'number',
        title: 'Size (KiB)',
        hidden: false,
        group: false,
        calculated: '[Bytes] / 1024',
      },
    ];
    expect(columnsOf(state, declared)).toEqual([
      { name: 'Timestamp', type: 'datetime' },
      { name: 'User', type: 'string', title: 'Analyst' },
      { name: 'Bytes', type: 'number' },
      { name: 'KiB', type: 'number', title: 'Size (KiB)', calculated: '[Bytes] / 1024' },
    ]);
  });

  it('gives a calculated column the analyst made or edited its expression, header and type', () => {
    const state: GridState = {
      ...untouched,
      columnOrder: {
        orderedColIds: ['Timestamp', 'User', 'Bytes', 'KiB', 'calculated_1', 'calculated_2'],
      },
      userColumns: [
        {
          colId: 'KiB',
          properties: [{ property: 'calculatedExpression', value: '[Bytes] / 1000' }],
        },
        {
          colId: 'calculated_1',
          created: true,
          properties: [
            { property: 'headerName', value: 'Big' },
            { property: 'calculatedExpression', value: '[Bytes] > 1000' },
            { property: 'cellDataType', value: 'boolean' },
          ],
        },
        {
          colId: 'calculated_2',
          created: true,
          properties: [
            { property: 'headerName', value: 'Note' },
            { property: 'calculatedExpression', value: '"n"' },
            { property: 'cellDataType', value: 'text' },
          ],
        },
      ],
    };
    const declared: CatalogueColumn[] = [
      { name: 'KiB', type: 'number', hidden: false, group: false, calculated: '[Bytes] / 1024' },
    ];
    expect(columnsOf(state, declared).slice(3)).toEqual([
      { name: 'KiB', type: 'number', calculated: '[Bytes] / 1000' },
      { name: 'calculated_1', type: 'boolean', title: 'Big', calculated: '[Bytes] > 1000' },
      { name: 'calculated_2', type: 'string', title: 'Note', calculated: '"n"' },
    ]);
  });

  it("leaves out TIM's own columns while they're as TIM sets them", () => {
    expect(columnsOf(untouched)).toEqual([
      { name: 'Timestamp', type: 'datetime' },
      { name: 'User', type: 'string' },
      { name: 'Bytes', type: 'number' },
    ]);
  });

  it("gives TIM's own columns that were shown, resized, renamed or moved, where they are", () => {
    const state: GridState = {
      ...untouched,
      columnOrder: {
        orderedColIds: ['Timestamp', 'tim:comments', 'User', 'Bytes', 'tim:tags', 'tim:label'],
      },
      columnVisibility: { hiddenColIds: ['tim:tags'] },
      columnSizing: {
        columnSizingModel: untouched.columnSizing!.columnSizingModel.map((s) =>
          s.colId === 'tim:tags' ? { ...s, width: 150 } : s,
        ),
      },
      columnHeaderName: { columnHeaderNames: [{ colId: 'tim:label', headerName: 'Verdict' }] },
    };
    expect(columnsOf(state)).toEqual([
      { name: 'Timestamp', type: 'datetime' },
      { name: 'tim:comments', type: 'string' },
      { name: 'User', type: 'string' },
      { name: 'Bytes', type: 'number' },
      { name: 'tim:tags', type: 'json', hidden: true, width: 150 },
      { name: 'tim:label', type: 'string', title: 'Verdict' },
    ]);
  });

  it("gives the declared columns' types when the run has no columns", () => {
    const declared: CatalogueColumn[] = [
      { name: 'Timestamp', type: 'datetime', hidden: false, group: false },
      { name: 'User', type: 'string', hidden: false, group: false },
    ];
    const text = actionFileColumns({ state: untouched, declared, runColumns: null, own });
    expect(load(text)).toEqual({
      columns: [
        { name: 'Timestamp', type: 'datetime' },
        { name: 'User', type: 'string' },
      ],
    });
  });
});
