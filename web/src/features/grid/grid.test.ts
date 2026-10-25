import { describe, expect, it } from 'vitest';
import { aggFuncs, dcount } from './aggregation';
import { buildColumnDefs, collectColumnNames } from './columns';
import {
  buildContextMenu,
  buildSelectionColumnDef,
  dateComparator,
  defaultColDef,
  quickFilterText,
} from './gridOptions';

describe('columns', () => {
  const rows = [{ A: 1 }, { A: 2, B: 'x' }, { C: true }];

  it('derives columns from the union of all rows', () => {
    expect(collectColumnNames(rows)).toEqual(['A', 'B', 'C']);
    expect(buildColumnDefs(rows).map((c) => [c.field, c.hide])).toEqual([
      ['A', undefined],
      ['B', undefined],
      ['C', undefined],
    ]);
  });

  it('gives no columns when there are no rows', () => {
    expect(buildColumnDefs([])).toEqual([]);
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
    expect(buildSelectionColumnDef()).toMatchObject({
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
