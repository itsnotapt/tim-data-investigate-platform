import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { SnackbarHost } from '../../components/SnackbarHost';
import type { CatalogueAction, Preset, PresetFields } from '../../lib/api';
import { newTestStore } from '../../test/tabsTestUtils';
import { createPresetsStore } from '../presets';
import { NewQueryMenu } from './NewQueryMenu';

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
      fromColumns: ['User'],
    },
    { name: 'limit', title: 'Limit', kind: 'number', required: false, many: false, default: 10 },
  ],
  pivot: null,
};

const ME = 'alice@example.com';
const base = {
  menuPath: ['Identity'],
  visibility: 'shared' as const,
  owned: false,
  hidden: false,
  action: 'dev-sign-ins',
  createdAt: '2026-10-22T00:00:00Z',
  updatedAt: '2026-10-22T00:00:00Z',
};
const PRESETS: Preset[] = [
  {
    ...base,
    presetId: 'p-mine',
    name: 'My bookmark',
    owner: ME,
    owned: true,
    visibility: 'private',
    params: { limit: 5 },
    inputs: [{ name: 'users', source: 'param', fixed: true, value: ['alice'] }],
  },
  {
    ...base,
    presetId: 'p-bob',
    name: 'Bob asks',
    owner: 'bob@example.com',
    params: {},
    inputs: [{ name: 'users', source: 'param', fixed: false, fromColumns: [] }],
  },
  {
    ...base,
    presetId: 'p-daily',
    name: 'Daily users',
    menuPath: ['Daily'],
    owner: ME,
    owned: true,
    params: {},
    inputs: [{ name: 'users', source: 'param', fixed: true, value: ['bob'] }],
  },
  {
    ...base,
    presetId: 'p-carol',
    name: 'Carol hidden',
    owner: 'carol@example.com',
    hidden: true,
    params: {},
    inputs: [],
  },
];

/** The presets API, kept in memory; `calls` records each change. */
function fakeApi() {
  let presets = structuredClone(PRESETS);
  const calls: string[] = [];
  const saved: PresetFields[] = [];
  const find = (id: string) => presets.find((p) => p.presetId === id)!;
  return {
    calls,
    saved,
    api: {
      list: () => Promise.resolve(structuredClone(presets)),
      create: (fields: PresetFields) => {
        calls.push(`create ${fields.name} ${fields.visibility}`);
        saved.push(fields);
        const created: Preset = { ...find('p-mine'), ...fields, presetId: 'p-new', owner: ME };
        presets = [...presets, created];
        return Promise.resolve(created);
      },
      replace: (id: string, fields: PresetFields) => {
        calls.push(`replace ${id} ${fields.visibility}`);
        saved.push(fields);
        Object.assign(find(id), fields);
        return Promise.resolve(find(id));
      },
      remove: (id: string) => {
        calls.push(`delete ${id}`);
        presets = presets.filter((p) => p.presetId !== id);
        return Promise.resolve();
      },
      setHidden: (id: string, hidden: boolean) => {
        calls.push(`${hidden ? 'hide' : 'unhide'} ${id}`);
        find(id).hidden = hidden;
        return Promise.resolve();
      },
      actionFile: (id: string) => Promise.resolve(`type: kql_query\nname: ${find(id).name}\n`),
    },
  };
}

function setup({ actions = [signIns] }: { actions?: CatalogueAction[] } = {}) {
  const tabs = newTestStore();
  const { api, calls, saved } = fakeApi();
  const presets = createPresetsStore({ api });
  render(
    <SnackbarHost>
      <MemoryRouter>
        <NewQueryMenu templates={[]} actions={actions} store={tabs} presetsStore={presets}>
          New
        </NewQueryMenu>
      </MemoryRouter>
    </SnackbarHost>,
  );
  return { tabs, calls, saved };
}

async function openFolder() {
  await userEvent.click(screen.getByRole('button', { name: 'New' }));
  await userEvent.click(screen.getByText('Actions and presets'));
  await userEvent.click(await screen.findByRole('button', { name: /^Identity/ }));
}

const more = (name: string) => screen.getByRole('button', { name: `More for ${name}` });

describe('NewQueryMenu presets', () => {
  it('lists presets beside the actions, with captions and folder counts', async () => {
    setup();
    await openFolder();
    expect(screen.getByRole('button', { name: 'Identity' })).toHaveTextContent('Identity3');
    expect(screen.getByText('Bookmark · alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('Sign-ins · asks for Users')).toBeInTheDocument();
    expect(screen.queryByText('Carol hidden')).not.toBeInTheDocument();
  });

  it('opens a bookmark as a tab holding its params', async () => {
    const { tabs } = setup();
    await openFolder();
    await userEvent.click(screen.getByText('My bookmark'));
    const [tab] = Object.values(tabs.getState().tabs);
    expect(tab?.title).toBe('My bookmark');
    expect(tab?.params).toEqual({
      action: 'dev-sign-ins',
      params: { limit: 5, users: ['alice'] },
      presetId: 'p-mine',
    });
    expect(tab?.state.pivotMissing ?? null).toBeNull();
  });

  it('opens a preset whose inputs have no columns asking for them', async () => {
    const { tabs } = setup();
    await openFolder();
    await userEvent.click(screen.getByText('Bob asks'));
    const [tab] = Object.values(tabs.getState().tabs);
    expect(tab?.params).toEqual({
      action: 'dev-sign-ins',
      params: { limit: 10 },
      presetId: 'p-bob',
    });
    expect(tab?.state.pivotMissing).toEqual({ users: null });
  });

  it("offers the owner's items on your own presets and read-only ones on others'", async () => {
    setup();
    await openFolder();
    await userEvent.click(more('My bookmark'));
    let items = within(screen.getByRole('menu', { name: 'My bookmark' }))
      .getAllByRole('menuitem')
      .map((i) => i.textContent);
    expect(items).toEqual(['Open', 'Edit…', 'Duplicate', 'Share with everyone', 'Delete…']);
    await userEvent.keyboard('{Escape}');

    await userEvent.click(more('Bob asks'));
    items = within(screen.getByRole('menu', { name: 'Bob asks' }))
      .getAllByRole('menuitem')
      .map((i) => i.textContent);
    expect(items).toEqual(['Open', 'Duplicate', 'Hide']);
  });

  it('copies a preset of an action with action files as one', async () => {
    const user = userEvent.setup();
    setup({ actions: [{ ...signIns, actionFile: true }] });
    await openFolder();
    await user.click(more('Bob asks'));
    await user.click(screen.getByRole('menuitem', { name: 'Copy as action file' }));

    expect(await screen.findByText('Copied "Bob asks" as an action file')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('type: kql_query\nname: Bob asks\n');
  });

  it('hides a preset for you, and shows it under Hidden to unhide', async () => {
    const { calls } = setup();
    await openFolder();
    await userEvent.click(more('Bob asks'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Hide' }));
    await waitFor(() => expect(screen.queryByText('Bob asks')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Hidden' }));
    expect(await screen.findByText('Bob asks')).toBeInTheDocument();
    expect(screen.getByText('Carol hidden')).toBeInTheDocument();
    await userEvent.click(more('Bob asks'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unhide' }));
    await waitFor(() => expect(screen.queryByText('Bob asks')).not.toBeInTheDocument());
    expect(calls).toEqual(['hide p-bob', 'unhide p-bob']);
  });

  it('filters to your presets or to others', async () => {
    setup();
    await openFolder();
    await userEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(await screen.findByText('My bookmark')).toBeInTheDocument();
    expect(screen.queryByText('Bob asks')).not.toBeInTheDocument();
    expect(screen.queryByText('Sign-ins')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: "Others'" }));
    expect(await screen.findByText('Bob asks')).toBeInTheDocument();
    expect(screen.queryByText('My bookmark')).not.toBeInTheDocument();
  });

  it('duplicates a preset into your own private copy, and shares and deletes your own', async () => {
    const { calls } = setup();
    await openFolder();
    await userEvent.click(more('Bob asks'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(await screen.findByText('Copy of Bob asks')).toBeInTheDocument();

    await userEvent.click(more('My bookmark'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Share with everyone' }));
    await userEvent.click(more('My bookmark'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete "My bookmark"?' })).getByRole('button', {
        name: 'Delete',
      }),
    );
    await waitFor(() => expect(screen.queryByText('My bookmark')).not.toBeInTheDocument());
    expect(calls).toEqual([
      'create Copy of Bob asks private',
      'replace p-mine shared',
      'delete p-mine',
    ]);
  });

  it('edits your own preset in the Save dialog, turning a fixed value into one from the row', async () => {
    const { calls } = setup();
    await openFolder();
    await userEvent.click(more('My bookmark'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit…' }));
    const dialog = screen.getByRole('dialog', { name: 'Save preset' });
    expect(within(dialog).getByText('Users = alice')).toBeInTheDocument();
    expect(within(dialog).getByText('Limit = 5')).toBeInTheDocument();

    await userEvent.clear(within(dialog).getByLabelText('Name'));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Sign-ins of a user');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Users from the row' }));
    expect(within(dialog).getByText('Users = <User of the clicked row>')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Update "My bookmark"' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Sign-ins of a user')).toBeInTheDocument();
    expect(screen.getByText('Sign-ins · pivot on User')).toBeInTheDocument();
    expect(calls).toEqual(['replace p-mine private']);
  });

  it('edits a preset without adding the values it leaves to the action, which show their type', async () => {
    const { saved } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    await userEvent.click(screen.getByText('Actions and presets'));
    await userEvent.click(await screen.findByRole('button', { name: 'Daily' }));
    await userEvent.click(more('Daily users'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit…' }));
    const dialog = screen.getByRole('dialog', { name: 'Save preset' });
    expect(within(dialog).getByText('Users = bob')).toBeInTheDocument();
    expect(within(dialog).getByText('Limit = <number>')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Update "Daily users"' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.params).toEqual({});
    expect(saved[0]?.inputs).toEqual([
      { name: 'users', source: 'param', fixed: true, value: ['bob'] },
    ]);
  });
});
