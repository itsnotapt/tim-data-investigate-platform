import { describe, expect, it } from 'vitest';
import { buildTemplateMenuTree, type MenuNode } from './templateMenuTree';
import type { QueryTemplate } from './types';

let n = 0;
function tpl(over: Partial<QueryTemplate>): QueryTemplate {
  n += 1;
  return {
    uuid: `u${n}`,
    name: `n${n}`,
    menu: `Menu ${n}`,
    summary: `Summary ${n}`,
    path: [],
    queryType: 'query',
    cluster: 'c',
    database: 'd',
    query: 'q',
    isDeleted: false,
    isManaged: false,
    createdBy: 'x',
    updatedBy: 'x',
    updated: '2024-01-01T00:00:00Z',
    ...over,
  };
}
const titles = (nodes: MenuNode[]): string[] =>
  nodes.map((x) => (x.kind === 'folder' ? `${x.title}/` : x.template.menu));

describe('buildTemplateMenuTree', () => {
  it('keeps same segment name under different paths apart', () => {
    const tree = buildTemplateMenuTree(
      [
        tpl({ menu: 'A1', path: ['Machine', 'Windows'] }),
        tpl({ menu: 'B1', path: ['User', 'Windows'] }),
        tpl({ menu: 'C1', path: ['Machine'] }),
      ],
      { queryType: 'query' },
    );
    expect(titles(tree)).toEqual(['Machine/', 'User/']);
    const [machine, user] = tree;
    if (machine?.kind !== 'folder' || user?.kind !== 'folder') throw new Error('folder');
    expect(titles(machine.children)).toEqual(['Windows/', 'C1']);
    expect(titles(user.children)).toEqual(['Windows/']);
    const mw = machine.children[0];
    const uw = user.children[0];
    if (mw?.kind !== 'folder' || uw?.kind !== 'folder') throw new Error('folder');
    expect(titles(mw.children)).toEqual(['A1']);
    expect(titles(uw.children)).toEqual(['B1']);
    expect(mw.key).not.toBe(uw.key);
  });

  it('filters by query type', () => {
    const tree = buildTemplateMenuTree(
      [tpl({ menu: 'V', queryType: 'view' }), tpl({ menu: 'Q' })],
      { queryType: 'view' },
    );
    expect(titles(tree)).toEqual(['V']);
  });

  it('searches menu and summary case-insensitively and nothing else', () => {
    const a = tpl({ menu: 'Show Children', summary: 'x', query: 'secret' });
    const b = tpl({ menu: 'other', summary: 'Timeline for {{MachineId}}' });
    const all = [a, b];
    expect(titles(buildTemplateMenuTree(all, { queryType: 'query', search: 'CHILD' }))).toEqual([
      'Show Children',
    ]);
    expect(titles(buildTemplateMenuTree(all, { queryType: 'query', search: 'timeline' }))).toEqual([
      'other',
    ]);
    expect(buildTemplateMenuTree(all, { queryType: 'query', search: 'secret' })).toEqual([]);
  });

  it('drops folders that have no matching templates', () => {
    const tree = buildTemplateMenuTree(
      [tpl({ menu: 'a', path: ['F'] }), tpl({ menu: 'b', path: ['G'] })],
      { queryType: 'query', search: 'b' },
    );
    expect(titles(tree)).toEqual(['G/']);
  });

  it('excludes hidden templates', () => {
    const a = tpl({ menu: 'a' });
    const b = tpl({ menu: 'b' });
    const tree = buildTemplateMenuTree([a, b], {
      queryType: 'query',
      queryOptions: { [a.uuid]: { hide: true }, [b.uuid]: { hide: false } },
    });
    expect(titles(tree)).toEqual(['b']);
  });
});
