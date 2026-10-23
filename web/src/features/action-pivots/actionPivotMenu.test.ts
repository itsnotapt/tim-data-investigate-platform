import type { MenuItemDef } from 'ag-grid-community';
import { vi } from 'vitest';
import type { CatalogueAction } from '../../lib/api';
import { buildActionPivotMenu } from './actionPivotMenu';

const action = (
  key: string,
  menuPath: string[],
  pivot: CatalogueAction['pivot'],
  name = key,
): CatalogueAction => ({
  key,
  kind: 'query',
  name,
  menuPath,
  connections: [],
  params: [],
  pivot,
});

const SESSIONS = action(
  'sessions',
  ['Identity', 'Pivots'],
  {
    rows: 'rows',
    columns: [['User', 'Upn']],
  },
  'Sessions',
);
const HOST = action('host', ['Hosts'], { rows: 'row', columns: [['Host']] }, 'Host details');
const ANY = action('any', [], { rows: 'rows', columns: [] }, 'Any rows');
const HIDDEN = action('hidden', [], null, 'Hidden');
const SINK: CatalogueAction = {
  ...action('save', [], { rows: 'rows', columns: [] }),
  kind: 'sink',
};
const ACTIONS = [SESSIONS, HOST, ANY, HIDDEN, SINK];

/** The menu's items as text: folders with their children, disabled items with their tooltip. */
function outline(items: readonly (MenuItemDef | string)[]): unknown[] {
  return items.map((item) =>
    typeof item === 'string'
      ? item
      : item.subMenu
        ? { [item.name]: outline(item.subMenu as MenuItemDef[]) }
        : item.disabled
          ? `${item.name} (disabled${item.tooltip ? `: ${item.tooltip}` : ''})`
          : item.name,
  );
}

const menu = (
  rows: Record<string, unknown>[],
  { recent = [] as string[], maxPivotRows = 100, onPivot = vi.fn() } = {},
) => buildActionPivotMenu({ actions: ACTIONS, rows, maxPivotRows, recent, onPivot });

describe('buildActionPivotMenu', () => {
  it('lists, by menu path, the actions whose pivot columns every row has one of', () => {
    expect(outline(menu([{ Upn: 'a', Host: 'pc-1' }]))).toEqual([
      {
        Pivot: [{ Identity: [{ Pivots: ['Sessions'] }] }, { Hosts: ['Host details'] }, 'Any rows'],
      },
    ]);
    expect(outline(menu([{ User: 'a' }, { Host: 'pc-1' }]))).toEqual([{ Pivot: ['Any rows'] }]);
  });

  it('is empty when no action pivots from the rows', () => {
    const only = buildActionPivotMenu({
      actions: [SESSIONS, HIDDEN],
      rows: [{ Host: 'pc-1' }],
      maxPivotRows: 100,
      recent: [],
      onPivot: vi.fn(),
    });
    expect(only).toEqual([]);
  });

  it('starts with Recent, the recent pivots that apply by their full menu path', () => {
    expect(
      outline(menu([{ User: 'a' }], { recent: ['any', 'host', 'gone', 'sessions'] }))[0],
    ).toEqual({
      Pivot: [
        'Recent (disabled)',
        'Any rows',
        'Identity / Pivots / Sessions',
        'separator',
        { Identity: [{ Pivots: ['Sessions'] }] },
        'Any rows',
      ],
    });
  });

  it('disables a one-row action for several rows, saying it takes one row', () => {
    expect(outline(menu([{ Host: 'pc-1' }, { Host: 'pc-2' }]))).toEqual([
      { Pivot: [{ Hosts: ['Host details (disabled: Takes one row)'] }, 'Any rows'] },
    ]);
  });

  it('disables every pivot over the row cap, with the counts', () => {
    const rows = Array.from({ length: 2500 }, () => ({ User: 'a' }));
    expect(outline(menu(rows))).toEqual(['Pivot (disabled: At most 100 rows; 2,500 selected)']);
  });

  it('pivots into the action chosen, from the tree or from Recent', () => {
    const onPivot = vi.fn();
    const [pivot] = menu([{ User: 'a' }], { recent: ['sessions'], onPivot });
    const [, recent, , identity] = pivot!.subMenu as MenuItemDef[];
    recent!.action!({} as never);
    const [pivots] = identity!.subMenu as MenuItemDef[];
    const [sessions] = pivots!.subMenu as MenuItemDef[];
    sessions!.action!({} as never);
    expect(onPivot.mock.calls).toEqual([[SESSIONS], [SESSIONS]]);
  });
});
