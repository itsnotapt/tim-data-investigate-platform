import { describe, expect, it } from 'vitest';
import { aggFuncs, dcount } from './aggregation';
import { buildColumnDefs, collectColumnNames, prepareRows } from './columns';
import {
  buildContextMenu,
  buildSelectionColumnDef,
  dateComparator,
  defaultColDef,
  quickFilterText,
} from './gridOptions';
import { getDetermination, rowClassRules } from './rowClasses';
import { createStatsStore, formatExecutionStats, formatMemoryMb } from './status';

describe('columns', () => {
  const rows = [{ A: 1 }, { A: 2, B: 'x' }, { C: true }];

  it('derives columns from the union of all rows', () => {
    expect(collectColumnNames(rows)).toEqual(['A', 'B', 'C']);
    expect(buildColumnDefs(rows).map((c) => c.field)).toEqual([
      'A',
      'B',
      'C',
      'TagEvent.Tags',
      'TagEvent.Comment',
      'TagEvent.Determination',
    ]);
  });

  it('gives no columns when there are no rows', () => {
    expect(buildColumnDefs([])).toEqual([]);
  });

  it('applies template overrides, declared columns first, default for the rest', () => {
    const defs = buildColumnDefs(rows, {
      B: { width: 50, headerName: 'Bee' },
      Z: { hide: true },
      default: { minWidth: 80 },
    });
    expect(defs.slice(0, 4)).toEqual([
      { field: 'B', headerName: 'Bee', width: 50, editable: false },
      { field: 'Z', headerName: 'Z', hide: true, editable: false },
      { field: 'A', headerName: 'A', minWidth: 80, editable: false },
      { field: 'C', headerName: 'C', minWidth: 80, editable: false },
    ]);
  });

  it('keeps hidden TagEvent columns hidden unless the template declares them', () => {
    const defs = buildColumnDefs(rows, { 'TagEvent.Comment': { hide: false } });
    expect(defs.find((c) => c.field === 'TagEvent.Comment')).toEqual({
      field: 'TagEvent.Comment',
      headerName: 'TagEvent.Comment',
      hide: false,
      editable: expect.any(Function) as unknown,
    });
    expect(defs.filter((c) => c.field === 'TagEvent.Comment')).toHaveLength(1);
  });

  it('assigns unique row ids, falling back to the row index', () => {
    const out = prepareRows([
      { EventId: 'a' },
      { EventId: 'a' },
      { EventId: '' },
      {},
      { EventId: 7 },
    ]);
    expect(out.map((r) => r._id)).toEqual(['a', 'row-index-1', 'row-index-2', 'row-index-3', '7']);
    expect(collectColumnNames(out)).toEqual(['EventId']);
    expect(prepareRows([{ K: 'x' }], 'K')[0]?._id).toBe('x');
  });
});

describe('row classes', () => {
  it('maps determination to a class', () => {
    const check = (d: unknown) =>
      Object.entries(rowClassRules)
        .filter(([, fn]) =>
          (fn as (p: { data: unknown }) => boolean)({ data: { TagEvent: { Determination: d } } }),
        )
        .map(([cls]) => cls);
    expect(check('malicious')).toEqual(['ag-tag-malicious']);
    expect(check('suspicious')).toEqual(['ag-tag-suspicious']);
    expect(check('benign')).toEqual(['ag-tag-benign']);
    expect(check('other')).toEqual([]);
    expect(getDetermination(undefined)).toBeNull();
    expect(getDetermination({ TagEvent: null })).toBeNull();
  });
});

describe('dcount', () => {
  it('counts distinct non-empty values, flattening arrays', () => {
    expect(dcount({ values: ['a', 'b', 'a', '', null, undefined, ['b', 'c']] })).toBe(3);
    expect(dcount({ values: [] })).toBe(0);
    expect(aggFuncs.dcount).toBe(dcount);
  });
});

describe('grid options helpers', () => {
  it('quick filter text stringifies objects', () => {
    expect(quickFilterText({ a: 1 })).toBe('{"a":1}');
    expect(quickFilterText(null)).toBe('');
    expect(quickFilterText(5)).toBe('5');
  });
  it('pins the selection checkbox column left', () => {
    expect(buildSelectionColumnDef(false, () => {})).toMatchObject({
      pinned: 'left',
      lockPinned: true,
    });
  });

  it('multi filter defaults', () => {
    const filters = (defaultColDef.filterParams as { filters: { filter: string }[] }).filters;
    expect(defaultColDef.filter).toBe('agMultiColumnFilter');
    expect(filters.map((f) => f.filter)).toEqual([
      'agTextColumnFilter',
      'agNumberColumnFilter',
      'agDateColumnFilter',
      'agSetColumnFilter',
    ]);
    expect(dateComparator(new Date('2024-01-02'), null)).toBe(-1);
    expect(dateComparator(new Date('2024-01-02'), '2024-01-03T00:00:00Z')).toBeGreaterThan(0);
  });
  it('context menu puts extras above copy/export', () => {
    expect(buildContextMenu()).toEqual(['copy', 'copyWithHeaders', 'export']);
    expect(buildContextMenu([{ name: 'X' }])).toEqual([
      { name: 'X' },
      'separator',
      'copy',
      'copyWithHeaders',
      'export',
    ]);
  });
});

describe('status formatting', () => {
  it('formats memory bytes as MB', () => {
    expect(formatMemoryMb(524384)).toBe('1MB');
    expect(formatMemoryMb(1048576 * 12)).toBe('12MB');
    expect(formatMemoryMb('2097152')).toBe('2MB');
    expect(formatMemoryMb(0)).toBeNull();
    expect(formatMemoryMb(null)).toBeNull();
  });
  it('lists only the known stats', () => {
    expect(
      formatExecutionStats({ executionTime: 0.42, cpuUsage: '00:00:00.1', memoryUsage: 1048576 }),
    ).toEqual([
      { label: 'Execution Time', value: '0.42' },
      { label: 'CPU Time', value: '00:00:00.1' },
      { label: 'Memory', value: '1MB' },
    ]);
    expect(formatExecutionStats({ executionTime: 0 })).toEqual([
      { label: 'Execution Time', value: '0' },
    ]);
    expect(formatExecutionStats({})).toEqual([]);
  });
  it('stats store notifies only on change', () => {
    const s = createStatsStore();
    let n = 0;
    s.subscribe(() => n++);
    s.set({ executionTime: 1 });
    s.set({ executionTime: 1 });
    expect(n).toBe(1);
  });
});
