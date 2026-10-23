import type { MenuItemDef } from 'ag-grid-community';
import { vi } from 'vitest';
import type { CatalogueAction } from '../../lib/api';
import { buildSinkMenu } from './sinkMenu';

const sink = (key: string, name: string, menuPath: string[]): CatalogueAction => ({
  key,
  kind: 'sink',
  name,
  menuPath,
  connections: [],
  params: [],
  pivot: { rows: 'rows', columns: [] },
});

const KUSTO = sink('kusto', 'Save event to Kusto', ['Save']);
const CASE = sink('case', 'Add to case', ['Save', 'Cases']);
const FILE = sink('file', 'Write file', []);
const QUERY: CatalogueAction = { ...sink('q', 'Hosts', ['Save']), kind: 'query' };

/** The menu's items as text: folders with their children, disabled items with their tooltip. */
function outline(items: readonly (MenuItemDef | string)[]): unknown[] {
  return items.map((item) =>
    typeof item === 'string'
      ? item
      : item.subMenu
        ? { [item.name]: outline(item.subMenu as MenuItemDef[]) }
        : item.disabled
          ? `${item.name} (disabled: ${item.tooltip})`
          : item.name,
  );
}

describe('buildSinkMenu', () => {
  it('lists the sinks under their menu paths, and runs the one picked', () => {
    const onRun = vi.fn();
    const items = buildSinkMenu({
      actions: [QUERY, KUSTO, CASE, FILE],
      rowCount: 3,
      max: 10,
      onRun,
    });
    expect(outline(items)).toEqual([
      { Save: [{ Cases: ['Add to case'] }, 'Save event to Kusto'] },
      'Write file',
    ]);
    (items[1] as MenuItemDef).action!({} as never);
    expect(onRun).toHaveBeenCalledWith(FILE);
  });

  it('disables each sink, with the reason, over the most rows a sink takes', () => {
    expect(
      outline(
        buildSinkMenu({ actions: [KUSTO, FILE], rowCount: 23_412, max: 10_000, onRun: vi.fn() }),
      ),
    ).toEqual([
      { Save: ['Save event to Kusto (disabled: At most 10,000 rows; 23,412 selected)'] },
      'Write file (disabled: At most 10,000 rows; 23,412 selected)',
    ]);
  });

  it('is empty when no sink is installed', () => {
    expect(buildSinkMenu({ actions: [QUERY], rowCount: 1, max: 10, onRun: vi.fn() })).toEqual([]);
  });
});
