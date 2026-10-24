import { describe, expect, it } from 'vitest';
import type { ColumnView } from '../../lib/api';
import { rankColumnViews } from './ranking';

let next = 0;
function view(name: string, changes: Partial<ColumnView> & { order?: string[] } = {}): ColumnView {
  const { order = [], ...rest } = changes;
  next += 1;
  return {
    viewId: `00000000-0000-0000-0000-${String(next).padStart(12, '0')}`,
    name,
    owner: 'alice@example.com',
    owned: true,
    hidden: false,
    visibility: 'private',
    savedFrom: { action: 'other' },
    state: { partialColumnState: true, columnOrder: { orderedColIds: order } },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...rest,
  };
}

/** The tab's columns, as the grid has them. */
const columns = ['ag-Grid-SelectionColumn', 'User', 'Host', 'Result', 'Ip', 'tim:label'];

const names = (views: { name: string }[]) => views.map((v) => v.name);

describe('rankColumnViews', () => {
  it('lists the views saved from this action first, then the others by matching columns', () => {
    const two = view('Two match', { order: ['User', 'Host', 'Gone'] });
    const own = view('Mine', { savedFrom: { action: 'sign-ins' }, order: ['Nothing'] });
    const three = view('Three match', { order: ['tim:label', 'Ip', 'User', 'Result'] });
    const none = view('No match', { order: ['Gone', 'tim:label', 'ag-Grid-SelectionColumn'] });

    const ranked = rankColumnViews([two, own, three, none], { action: 'sign-ins' }, columns);

    expect(names(ranked.own)).toEqual(['Mine']);
    expect(ranked.others).toEqual([
      { view: three, matching: 3, total: 4 },
      { view: two, matching: 2, total: 4 },
    ]);
  });

  it("matches a preset tab on the preset, not on the preset's action", () => {
    const presetId = '6f1c2a7e-8d0b-4c3e-9a51-2b7d4e6f8a90';
    const fromPreset = view('From preset', { savedFrom: { action: 'tim.run_kql', presetId } });
    const fromAction = view('From action', {
      savedFrom: { action: 'tim.run_kql' },
      order: ['User'],
    });
    const otherPreset = view('Other preset', {
      savedFrom: { action: 'tim.run_kql', presetId: '11111111-2222-4333-8444-555555555555' },
    });

    const preset = rankColumnViews(
      [fromPreset, fromAction, otherPreset],
      {
        action: 'tim.run_kql',
        presetId,
      },
      columns,
    );
    const action = rankColumnViews(
      [fromPreset, fromAction, otherPreset],
      { action: 'tim.run_kql' },
      columns,
    );

    expect(names(preset.own)).toEqual(['From preset']);
    expect(names(preset.others.map((o) => o.view))).toEqual(['From action']);
    expect(names(action.own)).toEqual(['From action']);
    expect(action.others).toEqual([]);
  });

  it('sorts by name within the same rank', () => {
    const b = view('beta', { savedFrom: { action: 'a' } });
    const a = view('Alpha', { savedFrom: { action: 'a' } });
    const d = view('delta', { order: ['User'] });
    const c = view('Charlie', { order: ['Host'] });

    const ranked = rankColumnViews([b, a, d, c], { action: 'a' }, columns);

    expect(names(ranked.own)).toEqual(['Alpha', 'beta']);
    expect(names(ranked.others.map((o) => o.view))).toEqual(['Charlie', 'delta']);
  });

  it('leaves out hidden views unless asked for them', () => {
    const own = view('Own hidden', { savedFrom: { action: 'a' }, hidden: true });
    const other = view('Other hidden', { hidden: true, order: ['User'] });

    const shown = rankColumnViews([own, other], { action: 'a' }, columns);
    const withHidden = rankColumnViews([own, other], { action: 'a' }, columns, {
      showHidden: true,
    });

    expect(shown).toEqual({ own: [], others: [] });
    expect(names(withHidden.own)).toEqual(['Own hidden']);
    expect(names(withHidden.others.map((o) => o.view))).toEqual(['Other hidden']);
  });
});
