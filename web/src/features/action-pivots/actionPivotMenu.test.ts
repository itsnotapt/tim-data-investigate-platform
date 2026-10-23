import type { MenuItemDef } from 'ag-grid-community';
import { vi } from 'vitest';
import type { CatalogueAction, Preset } from '../../lib/api';
import { buildActionPivotMenu } from './actionPivotMenu';

const action = (
  key: string,
  menuPath: string[],
  pivot: CatalogueAction['pivot'],
  name = key,
): CatalogueAction => ({
  key,
  kind: 'query',
  actionFile: false,
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
const BY_RESULT: CatalogueAction = {
  ...action('by-result', ['Identity'], null, 'Sign-ins with a result'),
  params: [
    {
      name: 'result',
      title: 'Result',
      kind: 'string',
      required: true,
      many: false,
      fromColumns: ['Result'],
    },
  ],
};
const ACTIONS = [SESSIONS, HOST, ANY, HIDDEN, BY_RESULT];

const preset = (
  presetId: string,
  name: string,
  menuPath: string[],
  overrides: Partial<Preset> = {},
): Preset => ({
  presetId,
  name,
  menuPath,
  owner: 'alice@example.com',
  visibility: 'shared',
  owned: false,
  hidden: false,
  action: 'by-result',
  params: {},
  inputs: [{ name: 'result', source: 'param', fixed: false, fromColumns: ['Result'] }],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...overrides,
});
const FAILED = preset('p-failed', 'Same result', ['Identity', 'Pivots']);
const PRESETS = [
  FAILED,
  preset('p-hidden', 'Hidden preset', [], { hidden: true }),
  preset('p-gone', 'Of a removed action', [], { action: 'gone' }),
  preset('p-bookmark', 'Bookmark', [], {
    inputs: [{ name: 'result', source: 'param', fixed: true, value: 'Failure' }],
  }),
];

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
  { recent = [] as string[], maxPivotRows = 100, onPivot = vi.fn(), onPivotPreset = vi.fn() } = {},
) =>
  buildActionPivotMenu({
    actions: ACTIONS,
    presets: PRESETS,
    connections: [],
    rows,
    maxPivotRows,
    recent,
    onPivot,
    onPivotPreset,
  });

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
      actions: [SESSIONS, HIDDEN, BY_RESULT],
      presets: PRESETS,
      connections: [],
      rows: [{ Host: 'pc-1' }],
      maxPivotRows: 100,
      recent: [],
      onPivot: vi.fn(),
      onPivotPreset: vi.fn(),
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

  it('lists the presets that pivot from the rows in the same folders as the actions, after them', () => {
    expect(outline(menu([{ User: 'a', Result: 'Failure' }]))).toEqual([
      { Pivot: [{ Identity: [{ Pivots: ['Sessions', 'Same result'] }] }, 'Any rows'] },
    ]);
    expect(outline(menu([{ Result: 'Failure' }, { User: 'b' }]))).toEqual([
      { Pivot: ['Any rows'] },
    ]);
  });

  it('disables a preset whose single-valued input the rows disagree on, with the reason', () => {
    expect(outline(menu([{ Result: 'Failure' }, { Result: 'Success' }]))).toEqual([
      {
        Pivot: [
          {
            Identity: [
              {
                Pivots: [
                  'Same result (disabled: The 2 selected rows have different Result values)',
                ],
              },
            ],
          },
          'Any rows',
        ],
      },
    ]);
  });

  it('lists a recent preset by its full menu path, and pivots with it resolved from the rows', () => {
    const onPivotPreset = vi.fn();
    const [pivot] = menu([{ Result: 'Failure' }], {
      recent: ['preset:p-failed', 'any'],
      onPivotPreset,
    });
    expect(outline([pivot!])).toEqual([
      {
        Pivot: [
          'Recent (disabled)',
          'Identity / Pivots / Same result',
          'Any rows',
          'separator',
          { Identity: [{ Pivots: ['Same result'] }] },
          'Any rows',
        ],
      },
    ]);
    const [, recent] = pivot!.subMenu as MenuItemDef[];
    recent!.action!({} as never);
    expect(onPivotPreset).toHaveBeenCalledWith(FAILED, BY_RESULT, {
      params: { result: 'Failure' },
      missing: {},
    });
  });
});
