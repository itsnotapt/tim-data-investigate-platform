import { describe, expect, it } from 'vitest';
import type { CatalogueAction, Preset } from '../../lib/api';
import {
  buildNewMenuTree,
  buildTemplateMenuTree,
  entryCaption,
  type MenuNode,
  type NewMenuEntry,
} from './menuTree';
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
const titles = (nodes: MenuNode<QueryTemplate>[]): string[] =>
  nodes.map((x) => (x.kind === 'folder' ? `${x.title}/` : x.label));

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

const signIns: CatalogueAction = {
  key: 'dev-sign-ins',
  kind: 'query',
  name: 'Sign-ins',
  menuPath: ['Identity'],
  connections: [],
  params: [
    {
      name: 'users',
      title: 'Users',
      kind: 'string',
      required: false,
      many: true,
      fromColumns: ['User', 'Upn'],
    },
  ],
  pivot: null,
};
const hosts: CatalogueAction = { ...signIns, key: 'dev-hosts', name: 'Hosts', menuPath: [] };

function preset(over: Partial<Preset>): Preset {
  return {
    presetId: over.name ?? 'p',
    name: 'p',
    menuPath: [],
    owner: 'alice@example.com',
    owned: true,
    visibility: 'private',
    hidden: false,
    action: 'dev-sign-ins',
    params: {},
    inputs: [],
    createdAt: '2026-10-22T00:00:00Z',
    updatedAt: '2026-10-22T00:00:00Z',
    ...over,
  };
}

const mine = preset({
  name: 'Alice bookmark',
  menuPath: ['Identity'],
  inputs: [{ name: 'users', source: 'param', fixed: true, value: ['alice'] }],
});
const theirs = preset({
  name: 'Bob pivot',
  owner: 'bob@example.com',
  owned: false,
  visibility: 'shared',
  menuPath: ['Identity', 'Daily'],
  inputs: [{ name: 'users', source: 'param', fixed: false, fromColumns: ['Account'] }],
});
const hidden = preset({
  name: 'Carol hidden',
  owner: 'carol@example.com',
  owned: false,
  visibility: 'shared',
  hidden: true,
});

const build = (search: string, filter: Parameters<typeof buildNewMenuTree>[2]['filter']) =>
  buildNewMenuTree([signIns, hosts], [mine, theirs, hidden], { search, filter });

/** Folders as `Title (count)/[...]`, items by label. */
function outline(nodes: MenuNode<NewMenuEntry>[]): unknown[] {
  return nodes.map((n) =>
    n.kind === 'folder' ? { [`${n.title} (${n.count})`]: outline(n.children) } : n.label,
  );
}

describe('buildNewMenuTree', () => {
  it('puts actions and presets in one folder namespace, with item counts on folders', () => {
    expect(outline(build('', 'all'))).toEqual([
      { 'Identity (3)': [{ 'Daily (1)': ['Bob pivot'] }, 'Sign-ins', 'Alice bookmark'] },
      'Hosts',
    ]);
  });

  it('filters presets by whose they are, and shows hidden ones only under Hidden', () => {
    expect(outline(build('', 'mine'))).toEqual([{ 'Identity (1)': ['Alice bookmark'] }]);
    expect(outline(build('', 'others'))).toEqual([
      { 'Identity (1)': [{ 'Daily (1)': ['Bob pivot'] }] },
    ]);
    expect(outline(build('', 'hidden'))).toEqual(['Carol hidden']);
  });

  it('searches name, folder, action, owner and From columns', () => {
    expect(outline(build('bob@', 'all'))).toEqual([
      { 'Identity (1)': [{ 'Daily (1)': ['Bob pivot'] }] },
    ]);
    expect(outline(build('ACCOUNT', 'all'))).toEqual([
      { 'Identity (1)': [{ 'Daily (1)': ['Bob pivot'] }] },
    ]);
    expect(outline(build('daily', 'all'))).toEqual([
      { 'Identity (1)': [{ 'Daily (1)': ['Bob pivot'] }] },
    ]);
    expect(outline(build('hosts', 'all'))).toEqual(['Hosts']);
    // The action's name finds its presets too.
    expect(outline(build('sign-ins', 'mine'))).toEqual([{ 'Identity (1)': ['Alice bookmark'] }]);
  });
});

describe('entryCaption', () => {
  it('names a bookmark and its owner, and a pivot preset its action and columns', () => {
    expect(entryCaption({ kind: 'preset', preset: mine, action: signIns })).toBe(
      'Bookmark · alice@example.com',
    );
    expect(entryCaption({ kind: 'preset', preset: theirs, action: signIns })).toBe(
      'Sign-ins · pivot on Account',
    );
  });

  it('says which values a preset asks for when its From-row inputs have no columns', () => {
    const asks = preset({
      inputs: [{ name: 'users', source: 'param', fixed: false, fromColumns: [] }],
    });
    expect(entryCaption({ kind: 'preset', preset: asks, action: signIns })).toBe(
      'Sign-ins · asks for Users',
    );
  });
});
