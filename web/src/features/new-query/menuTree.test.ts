import { describe, expect, it } from 'vitest';
import type { CatalogueAction, Preset } from '../../lib/api';
import { buildNewMenuTree, entryCaption, type MenuNode, type NewMenuEntry } from './menuTree';

const signIns: CatalogueAction = {
  key: 'dev-sign-ins',
  kind: 'query',
  actionFile: false,
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

  it('keeps the same folder name under different parents apart', () => {
    const at = (key: string, menuPath: string[]): CatalogueAction => ({
      ...hosts,
      key,
      name: key,
      menuPath,
    });
    const tree = buildNewMenuTree(
      [at('A1', ['Machine', 'Windows']), at('B1', ['User', 'Windows']), at('C1', ['Machine'])],
      [],
      { filter: 'all' },
    );
    expect(outline(tree)).toEqual([
      { 'Machine (2)': [{ 'Windows (1)': ['A1'] }, 'C1'] },
      { 'User (1)': [{ 'Windows (1)': ['B1'] }] },
    ]);
    const [machine, user] = tree;
    if (machine?.kind !== 'folder' || user?.kind !== 'folder') throw new Error('folder');
    expect(machine.children[0]?.key).not.toBe(user.children[0]?.key);
  });

  it('leaves out sinks, which run only on rows', () => {
    const save: CatalogueAction = {
      ...signIns,
      key: 'dev-save',
      kind: 'sink',
      name: 'Save',
      params: [],
      pivot: { rows: 'rows', columns: [] },
    };
    expect(outline(buildNewMenuTree([hosts, save], [], { filter: 'all' }))).toEqual(['Hosts']);
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
