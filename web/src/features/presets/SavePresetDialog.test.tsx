import { createTheme } from '@mui/material/styles';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueAction, Preset, PresetFields } from '../../lib/api';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { useInstanceStore } from '../instance';
import { createPresetsStore } from './presetsStore';
import { SavePresetDialog } from './SavePresetDialog';

const runKql: CatalogueAction = {
  key: 'tim.run_kql',
  kind: 'query',
  actionFile: true,
  findPivotRows: false,
  name: 'Run KQL',
  menuPath: [],
  connections: [],
  params: [
    {
      name: 'connection',
      kind: 'connection',
      connectionType: 'kusto',
      required: true,
      many: false,
    },
    { name: 'database', kind: 'string', required: true, many: false },
    { name: 'kql', kind: 'kql', required: true, many: false },
    { name: 'parameters', kind: 'json', required: false, many: false },
  ],
  pivot: null,
};

const runSql: CatalogueAction = {
  ...runKql,
  key: 'tim.run_sql',
  name: 'Run SQL',
  params: [
    {
      name: 'connection',
      kind: 'connection',
      connectionType: 'snowflake',
      required: true,
      many: false,
    },
    { name: 'sql', kind: 'sql', required: true, many: false },
    { name: 'parameters', kind: 'json', required: false, many: false },
  ],
};

const server = setupMswServer();
/** The declare statements asked for, by action. */
let declared: { key: string; parameters: { name: string; type: string }[] }[] = [];

beforeEach(() => {
  configureTestApp();
  declared = [];
  // Run KQL declares its query parameters, refusing a name that isn't a Kusto identifier; Run SQL
  // declares nothing.
  server.use(
    http.post(apiUrl('/api/actions/:key/declareStatement'), async ({ params, request }) => {
      const { parameters } = (await request.json()) as (typeof declared)[number];
      declared.push({ key: String(params.key), parameters });
      if (params.key !== 'tim.run_kql') return new HttpResponse(null, { status: 204 });
      if (!parameters.every((p) => /^[A-Za-z_]\w*$/.test(p.name))) return problemResponse(422);
      const names = parameters.map((p) => `${p.name}:${p.type}`).join(', ');
      return HttpResponse.json({ declareStatement: `declare query_parameters(${names});` });
    }),
  );
});
afterEach(resetTestApp);

const KQL = 'SigninLogs | where UserPrincipalName == Upn and TimeGenerated > Since';
const tab = { connection: 'security', database: 'Samples', kql: KQL };

/** The presets API, listing `presets` and keeping what was saved. */
function setup(
  params: Record<string, unknown>,
  action: CatalogueAction = runKql,
  idColumn: string | null = null,
  source?: Preset,
  presets: Preset[] = [],
  onClose: () => void = () => {},
) {
  const saved: PresetFields[] = [];
  const api = {
    list: () => Promise.resolve(presets),
    create: (fields: PresetFields) => {
      saved.push(fields);
      return Promise.resolve({ ...fields, presetId: 'p-1' } as Preset);
    },
    replace: () => Promise.reject(new Error('not used')),
    remove: () => Promise.resolve(),
    setHidden: () => Promise.resolve(),
    actionFile: () => Promise.resolve(''),
  };
  const store = createPresetsStore({ api });
  void store.getState().refresh();
  render(
    <SavePresetDialog
      action={action}
      params={params}
      idColumn={idColumn}
      source={source}
      onClose={onClose}
      store={store}
    />,
  );
  return { saved, dialog: screen.getByRole('dialog', { name: 'Save preset' }) };
}

const tabTitle = () => screen.getByRole('combobox', { name: 'Tab title' });
/** The placeholders the Tab title suggests, in order. */
const suggestions = () =>
  within(screen.getByRole('listbox', { name: 'Placeholders' }))
    .getAllByRole('option')
    .map((o) => o.textContent);
/** The row of the inputs table for the param `name`. */
const inputRow = (name: string) => screen.getByRole('row', { name });
/** Picks `option` ('Fixed' or 'From row') in the Source dropdown of `row`. */
const pickSource = async (row: HTMLElement, option: 'Fixed' | 'From row') => {
  await userEvent.click(within(row).getByRole('combobox', { name: 'Source' }));
  await userEvent.click(screen.getByRole('option', { name: new RegExp(`^${option}`) }));
};
const parameter = (n: number) => inputRow(`Query parameter ${n}`);
/** The lines of the query block. */
const lines = () =>
  within(screen.getByRole('list', { name: 'Query' }))
    .getAllByRole('listitem')
    .map((e) => e.textContent);
/** Types `columns` into the From row columns of `row`, each as a chip. */
const typeColumns = async (row: HTMLElement, ...columns: string[]) => {
  const field = within(row).getByRole('combobox', { name: 'Columns' });
  for (const column of columns) await userEvent.type(field, `${column}{Enter}`);
};

describe('SavePresetDialog Id column', () => {
  it('saves the tab’s Id column, when it isn’t the action’s', async () => {
    const { saved, dialog } = setup(tab, runKql, 'Host');
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'By host');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ name: 'By host', idColumn: 'Host' });
  });
});

describe('SavePresetDialog params read from the row', () => {
  const signIns: CatalogueAction = {
    ...runKql,
    key: 'dev-sign-ins',
    name: 'Sign-ins',
    params: [
      {
        name: 'users',
        kind: 'string',
        required: true,
        many: true,
        fromColumns: ['User'],
      },
      {
        name: 'hosts',
        kind: 'string',
        required: false,
        many: true,
        fromColumns: ['Host'],
      },
    ],
  };

  it('saves each param read from the row with its columns, and each fixed one with its value', async () => {
    const { saved, dialog } = setup({ users: ['alice'], hosts: [] }, signIns);
    expect(within(inputRow('users')).getByRole('combobox', { name: 'Source' })).toHaveTextContent(
      'Fixed',
    );
    expect(within(inputRow('users')).getByText('alice')).toBeInTheDocument();
    expect(within(inputRow('hosts')).getByRole('combobox', { name: 'Source' })).toHaveTextContent(
      'From row',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.inputs).toEqual([
      { name: 'users', source: 'param', fixed: true, value: ['alice'] },
      { name: 'hosts', source: 'param', fixed: false, fromColumns: ['Host'] },
    ]);
  });

  it('saves a param switched to From row with its columns, and one switched to Fixed with its value', async () => {
    const { saved, dialog } = setup({ users: ['alice'], hosts: ['web-01'] }, signIns);
    await pickSource(inputRow('users'), 'From row');
    await pickSource(inputRow('hosts'), 'From row');
    await pickSource(inputRow('hosts'), 'Fixed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.inputs).toEqual([
      { name: 'users', source: 'param', fixed: false, fromColumns: ['User'] },
      { name: 'hosts', source: 'param', fixed: true, value: ['web-01'] },
    ]);
  });

  it('shows the type of a param switched to Fixed while it has no value', async () => {
    setup({ users: ['alice'], hosts: [] }, signIns);
    await pickSource(inputRow('hosts'), 'Fixed');
    expect(within(inputRow('hosts')).getByText('<string>')).toBeInTheDocument();
  });

  it('describes each source in the same lines for every input', async () => {
    setup({ users: ['alice'], hosts: [] }, signIns);
    for (const name of ['users', 'hosts']) {
      await userEvent.click(within(inputRow(name)).getByRole('combobox', { name: 'Source' }));
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Fixed' +
          'Valuesaved with the preset, as it is now' +
          'Tabsevery tab opened from the preset starts with it',
        'From row' +
          'Valuethe first of its columns with a value in the row' +
          'Several rowsmust match, unless the input takes a list' +
          'Right-clickoffered on rows that have one of its columns' +
          'New menuthe tab asks for it',
      ]);
      await userEvent.keyboard('{Escape}');
    }
  });
});

describe('SavePresetDialog From row columns', () => {
  const byUser: CatalogueAction = {
    ...runKql,
    key: 'dev-by-user',
    name: 'By user',
    params: [
      {
        name: 'users',
        kind: 'string',
        required: true,
        many: true,
        fromColumns: ['User', 'Upn', 'Account'],
      },
    ],
  };

  it('are the input’s columns as chips, two shown then a count', () => {
    setup({ users: [] }, byUser);
    const row = inputRow('users');
    expect(within(row).getByText('User')).toBeInTheDocument();
    expect(within(row).getByText('Upn')).toBeInTheDocument();
    expect(within(row).queryByText('Account')).not.toBeInTheDocument();
    expect(within(row).getByText('+1')).toBeInTheDocument();
  });

  it('are saved in the input’s order of columns, whatever order they are picked in', async () => {
    const { saved, dialog } = setup({ users: [] }, byUser);
    const columns = within(inputRow('users')).getByRole('combobox', { name: 'Columns' });
    await userEvent.click(columns);
    await userEvent.keyboard('{Backspace}{Backspace}{Backspace}');
    await userEvent.click(screen.getByRole('option', { name: 'Account' }));
    await userEvent.click(columns);
    await userEvent.click(screen.getByRole('option', { name: 'User' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.inputs).toEqual([
      { name: 'users', source: 'param', fixed: false, fromColumns: ['User', 'Account'] },
    ]);
  });

  it('are trimmed when typed, and a blank one is dropped', async () => {
    const { saved, dialog } = setup({ ...tab, parameters: [{ name: 'Upn', type: 'string' }] });
    await typeColumns(parameter(1), ' UserPrincipalName ', '  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.inputs).toEqual([
      {
        name: 'Upn',
        source: 'queryParameter',
        type: 'string',
        fixed: false,
        fromColumns: ['UserPrincipalName'],
      },
    ]);
  });

  it('can all be removed, so the tab asks for the value', async () => {
    const { saved, dialog } = setup({ users: [] }, byUser);
    await userEvent.click(within(inputRow('users')).getByRole('combobox', { name: 'Columns' }));
    await userEvent.keyboard('{Backspace}{Backspace}{Backspace}');
    expect(within(inputRow('users')).getByRole('combobox', { name: 'Columns' })).toHaveAttribute(
      'placeholder',
      'None: asked for when opened',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.inputs).toEqual([
      { name: 'users', source: 'param', fixed: false, fromColumns: [] },
    ]);
  });
});

describe('SavePresetDialog Tab title', () => {
  const signIns: CatalogueAction = {
    ...runKql,
    key: 'dev-sign-ins',
    name: 'Sign-ins',
    params: [
      { name: 'users', kind: 'string', required: true, many: true, fromColumns: ['User'] },
      { name: 'hosts', kind: 'string', required: false, many: true, fromColumns: ['Host'] },
    ],
  };
  const mine: Preset = {
    presetId: 'p-1',
    name: 'Mine',
    title: 'Sign-ins of {users} on {hosts}',
    menuPath: [],
    owner: 'alice@example.com',
    visibility: 'private',
    owned: true,
    hidden: false,
    action: 'dev-sign-ins',
    params: {},
    inputs: [
      { name: 'users', source: 'param', fixed: false, fromColumns: ['User'] },
      { name: 'hosts', source: 'param', fixed: false, fromColumns: ['Host'] },
    ],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
  /** Replaces the text of `field` with `text`, which may hold `{`. */
  const retype = async (field: HTMLElement, text: string) => {
    await userEvent.clear(field);
    await userEvent.paste(text);
  };

  it('is the name then a placeholder for each From row input, following both until edited', async () => {
    const { dialog } = setup({ users: ['alice'], hosts: [] }, signIns);
    expect(tabTitle()).toHaveValue('Sign-ins {hosts}');

    await pickSource(inputRow('users'), 'From row');
    expect(tabTitle()).toHaveValue('Sign-ins {users} {hosts}');
    await retype(within(dialog).getByRole('textbox', { name: 'Name' }), 'My sign-ins');
    expect(tabTitle()).toHaveValue('My sign-ins {users} {hosts}');

    await retype(tabTitle(), 'Hosts {hosts}');
    await retype(within(dialog).getByRole('textbox', { name: 'Name' }), 'Renamed');
    await pickSource(inputRow('users'), 'Fixed');
    expect(tabTitle()).toHaveValue('Hosts {hosts}');
  });

  it('is saved as the preset’s title template', async () => {
    const { saved, dialog } = setup({ users: ['alice'], hosts: [] }, signIns);
    await retype(tabTitle(), 'Sign-ins on {hosts} for {users}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({
      name: 'Sign-ins',
      title: 'Sign-ins on {hosts} for {users}',
    });
  });

  it('of a preset being edited is its saved template, kept when it is renamed', async () => {
    const { saved, dialog } = setup({ users: [], hosts: [] }, signIns, null, mine);
    expect(tabTitle()).toHaveValue('Sign-ins of {users} on {hosts}');

    await retype(within(dialog).getByRole('textbox', { name: 'Name' }), 'Also mine');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save as new' }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ name: 'Also mine', title: 'Sign-ins of {users} on {hosts}' });
  });

  it('must not be blank', async () => {
    const { dialog } = setup({ users: ['alice'], hosts: [] }, signIns);
    await userEvent.clear(tabTitle());
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('says which placeholder names nothing, and saves once each names a param or a row column', async () => {
    const { dialog } = setup({ users: ['alice'], hosts: [] }, signIns);
    await retype(tabTitle(), 'Sign-ins of {user} on {row.}');
    expect(tabTitle()).toHaveAccessibleDescription('{user} and {row.} name nothing');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await retype(tabTitle(), 'Sign-ins of {users} on {row.Host}');
    expect(tabTitle()).not.toHaveAccessibleDescription(/nothing/);
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  /** An action with inputs, other params and query parameters. */
  const hunt: CatalogueAction = {
    ...runKql,
    key: 'dev-hunt',
    name: 'Hunt',
    params: [
      {
        name: 'users',
        kind: 'string',
        required: true,
        many: true,
        fromColumns: ['User', 'UserPrincipalName'],
      },
      { name: 'host', kind: 'string', required: false, many: false, fromColumns: ['Host'] },
      ...runKql.params,
    ],
  };
  const hunting = {
    ...tab,
    users: [],
    host: 'web-01',
    parameters: [
      { name: 'Since', type: 'datetime', value: '2026-10-01T00:00:00Z' },
      { name: 'Upn', type: 'string' },
    ],
  };

  it('suggests on { the inputs, the other params, the query parameters, then the From row columns', async () => {
    setup(hunting, hunt);
    await userEvent.clear(tabTitle());
    await userEvent.type(tabTitle(), 'Hunt for {{');

    expect(suggestions()).toEqual([
      '{users}',
      '{host}',
      '{connection}',
      '{database}',
      '{kql}',
      '{Since}',
      '{Upn}',
      '{row.User}',
      '{row.UserPrincipalName}',
    ]);
  });

  it('filters the suggestions by what follows the {, and closes them with the }', async () => {
    setup(hunting, hunt);
    await userEvent.clear(tabTitle());
    await userEvent.type(tabTitle(), 'Hunt for {{u');
    expect(suggestions()).toEqual(['{users}', '{Upn}', '{row.User}', '{row.UserPrincipalName}']);

    await userEvent.type(tabTitle(), 'ser');
    expect(suggestions()).toEqual(['{users}', '{row.User}', '{row.UserPrincipalName}']);
    await userEvent.type(tabTitle(), 's}');
    expect(screen.queryByRole('listbox', { name: 'Placeholders' })).not.toBeInTheDocument();
  });

  it('suggests any row column from row., and still takes a column it doesn’t suggest', async () => {
    const { dialog } = setup(hunting, hunt);
    await userEvent.clear(tabTitle());
    await userEvent.type(tabTitle(), 'Hunt on {{row.');
    expect(suggestions()).toEqual(['{row.User}', '{row.UserPrincipalName}']);

    await userEvent.type(tabTitle(), 'Computer}');
    expect(tabTitle()).toHaveValue('Hunt on {row.Computer}');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('inserts the first suggestion on Enter or Tab, where the { was typed', async () => {
    setup(hunting, hunt);
    await userEvent.clear(tabTitle());
    await userEvent.type(tabTitle(), 'Hunt for {{us{Enter}');
    expect(tabTitle()).toHaveValue('Hunt for {users}');
    expect(screen.queryByRole('listbox', { name: 'Placeholders' })).not.toBeInTheDocument();

    await userEvent.type(tabTitle(), ' on {{ho');
    await userEvent.tab();
    expect(tabTitle()).toHaveValue('Hunt for {users} on {host}');
    expect(tabTitle()).toHaveFocus();

    await userEvent.type(tabTitle(), ' in {{dat{Enter}', {
      initialSelectionStart: 4,
      initialSelectionEnd: 4,
    });
    expect(tabTitle()).toHaveValue('Hunt in {database} for {users} on {host}');
  });

  it('closes the suggestions on Escape, leaving the dialog open', async () => {
    const onClose = vi.fn();
    setup(hunting, hunt, null, undefined, [], onClose);
    await userEvent.clear(tabTitle());
    await userEvent.type(tabTitle(), 'Hunt for {{us');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'Placeholders' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    expect(tabTitle()).toHaveValue('Hunt for {us');

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('gives an example of the name and the first inputs as placeholders, following the name', async () => {
    const { dialog } = setup({ users: ['alice'], hosts: [] }, signIns);
    expect(tabTitle()).toHaveAccessibleDescription('e.g. Sign-ins for {users} on {hosts}');

    await retype(within(dialog).getByRole('textbox', { name: 'Name' }), 'Logons');
    expect(tabTitle()).toHaveAccessibleDescription('e.g. Logons for {users} on {hosts}');
  });

  it('gives an example of the query parameters when they are the only inputs', () => {
    setup({ ...tab, parameters: [{ name: 'Upn', type: 'string' }] });
    expect(tabTitle()).toHaveAccessibleDescription('e.g. Run KQL for {Upn}');
  });

  it('gives an example of the action’s params when it has no inputs', () => {
    setup(tab);
    expect(tabTitle()).toHaveAccessibleDescription('e.g. Run KQL for {connection} on {database}');
  });

  it('highlights the placeholders that name something in the primary colour, and the others as errors', async () => {
    const { dialog } = setup({ users: ['alice'], hosts: [] }, signIns);
    await retype(tabTitle(), 'Sign-ins of {users} on {host} at {row.Host}');

    const { palette } = createTheme();
    expect(within(dialog).getByText('{users}')).toHaveStyle({ color: palette.primary.main });
    expect(within(dialog).getByText('{row.Host}')).toHaveStyle({ color: palette.primary.main });
    expect(within(dialog).getByText('{host}')).toHaveStyle({ color: palette.error.main });
    expect(within(dialog).getByText('on')).not.toHaveStyle({ color: palette.primary.main });
  });

  it('replaces the Show in title switches', () => {
    const { dialog } = setup({ users: ['alice'], hosts: [] }, signIns);
    expect(within(dialog).queryByRole('switch', { name: /in title/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Show in title')).not.toBeInTheDocument();
  });
});

describe('SavePresetDialog query parameters', () => {
  it("saves the tab's query parameters, one fixed and one read from the row", async () => {
    const { saved, dialog } = setup({
      ...tab,
      parameters: [
        { name: 'Upn', type: 'string', value: 'alice@example.com' },
        { name: 'Since', type: 'datetime', value: '2026-10-01T00:00:00Z' },
        { name: 'States', type: 'dynamic', value: ['TEXAS', 'FLORIDA'] },
      ],
    });
    expect(within(parameter(1)).getByRole('combobox', { name: 'Name' })).toHaveValue('Upn');
    expect(within(parameter(2)).getByRole('combobox', { name: 'Type' })).toHaveValue('datetime');
    expect(within(parameter(3)).getByRole('textbox', { name: 'Value' })).toHaveValue(
      '["TEXAS","FLORIDA"]',
    );

    await pickSource(parameter(1), 'From row');
    await typeColumns(parameter(1), 'UserPrincipalName', 'Upn');
    expect(tabTitle()).toHaveValue('Run KQL {Upn}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(saved).toEqual([
      expect.objectContaining({
        params: tab,
        title: 'Run KQL {Upn}',
        inputs: [
          {
            name: 'Upn',
            source: 'queryParameter',
            type: 'string',
            fixed: false,
            fromColumns: ['UserPrincipalName', 'Upn'],
          },
          {
            name: 'Since',
            source: 'queryParameter',
            type: 'datetime',
            fixed: true,
            value: '2026-10-01T00:00:00Z',
          },
          {
            name: 'States',
            source: 'queryParameter',
            type: 'dynamic',
            fixed: true,
            value: ['TEXAS', 'FLORIDA'],
          },
        ],
      }),
    ]);
  });

  it('declares a query parameter added and named from the query, with a typed value', async () => {
    const kql = "SigninLogs // by Upn2\n| where Note != 'Since2' and TimeGenerated > Since";
    const { saved, dialog } = setup({ ...tab, kql });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Add query parameter' }));
    await userEvent.click(within(parameter(1)).getByRole('combobox', { name: 'Name' }));
    const names = screen.getAllByRole('option').map((o) => o.textContent);
    expect(names).toContain('Since');
    expect(names).not.toEqual(expect.arrayContaining(['Upn2']));
    expect(names).not.toEqual(expect.arrayContaining(['Since2']));
    expect(names).not.toEqual(expect.arrayContaining(['where']));
    await userEvent.click(screen.getByRole('option', { name: 'Since' }));
    await userEvent.selectOptions(
      within(parameter(1)).getByRole('combobox', { name: 'Type' }),
      'datetime',
    );
    const value = within(parameter(1)).getByRole('textbox', { name: 'Value' });
    expect(value).toHaveAttribute('placeholder', '<datetime>');
    await userEvent.type(value, 'yesterday');

    expect(value).toHaveAccessibleDescription('Must be an ISO 8601 datetime');
    expect(within(dialog).getByText(/^Since:/)).toHaveTextContent(
      'Since: Must be an ISO 8601 datetime',
    );
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.clear(value);
    await userEvent.type(value, '2026-10-01T00:00:00Z');
    expect(value).not.toHaveAccessibleDescription();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(saved[0]?.inputs).toEqual([
      {
        name: 'Since',
        source: 'queryParameter',
        type: 'datetime',
        fixed: true,
        value: '2026-10-01T00:00:00Z',
      },
    ]);
  });

  it('removes a query parameter, and asks for a name that is a Kusto identifier', async () => {
    const { saved, dialog } = setup({
      ...tab,
      parameters: [{ name: 'Upn', type: 'string', value: 'alice@example.com' }],
    });
    const name = within(parameter(1)).getByRole('combobox', { name: 'Name' });

    await userEvent.clear(name);
    await userEvent.type(name, 'a b');
    expect(name).toHaveAccessibleDescription(
      'Starts with a letter or _ and holds only letters, digits and _',
    );
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.click(within(parameter(1)).getByRole('button', { name: 'Remove' }));
    expect(within(dialog).queryByRole('row', { name: /^Query parameter/ })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(saved[0]).toMatchObject({ params: tab, inputs: [] });
  });

  it('moves a query parameter up or down, which declares it at its new place', async () => {
    const { saved, dialog } = setup({
      ...tab,
      parameters: [
        { name: 'Upn', type: 'string', value: 'alice@example.com' },
        { name: 'Within', type: 'timespan', value: 'PT1H' },
        { name: 'Top', type: 'long', value: 10 },
      ],
    });

    expect(within(parameter(1)).getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(within(parameter(3)).getByRole('button', { name: 'Move down' })).toBeDisabled();
    await userEvent.click(within(parameter(2)).getByRole('button', { name: 'Move up' }));
    await userEvent.click(within(parameter(2)).getByRole('button', { name: 'Move down' }));

    await vi.waitFor(() =>
      expect(lines()[0]).toBe('declare query_parameters(Within:timespan, Top:long, Upn:string);'),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(saved[0]?.inputs?.map((i) => i.name)).toEqual(['Within', 'Top', 'Upn']);
  });

  it('are not offered for an action that takes none', () => {
    const signIns: CatalogueAction = {
      ...runKql,
      params: [{ name: 'users', kind: 'string', required: true, many: true, fromColumns: ['U'] }],
    };
    const { dialog } = setup({ users: [] }, signIns);
    expect(
      within(dialog).queryByRole('button', { name: 'Add query parameter' }),
    ).not.toBeInTheDocument();
  });
});

describe('SavePresetDialog query parameters of SQL', () => {
  const SQL = 'SELECT * FROM SIGNINS WHERE UPN = :1 AND AT >= :2';
  const sqlTab = { connection: 'warehouse', sql: SQL };

  it('shows each one at the position it is bound to, and moving one changes it', async () => {
    const { saved, dialog } = setup(
      {
        ...sqlTab,
        parameters: [
          { name: 'since', type: 'datetime', value: '2026-10-01T00:00:00Z' },
          { name: 'upns', type: 'dynamic', value: ['alice@example.com', 'bob@example.com'] },
        ],
      },
      runSql,
    );
    expect(within(parameter(1)).getByText(':1')).toBeInTheDocument();
    expect(within(parameter(2)).getByText(':2')).toBeInTheDocument();

    await userEvent.click(within(parameter(1)).getByRole('button', { name: 'Move down' }));
    await pickSource(parameter(1), 'From row');
    await typeColumns(parameter(1), 'UPN');

    expect(within(parameter(1)).getByRole('combobox', { name: 'Name' })).toHaveValue('upns');
    expect(within(parameter(1)).getByText(':1')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(saved[0]?.inputs).toEqual([
      {
        name: 'upns',
        source: 'queryParameter',
        type: 'dynamic',
        fixed: false,
        fromColumns: ['UPN'],
      },
      {
        name: 'since',
        source: 'queryParameter',
        type: 'datetime',
        fixed: true,
        value: '2026-10-01T00:00:00Z',
      },
    ]);
  });

  it('offers no timespan, which Snowflake has not', async () => {
    const { dialog } = setup(sqlTab, runSql);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add query parameter' }));
    const types = within(within(parameter(1)).getByRole('combobox', { name: 'Type' }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(types).toEqual(['string', 'long', 'real', 'bool', 'datetime', 'dynamic']);
  });
});

describe('SavePresetDialog query block', () => {
  it('shows a Run KQL query after the declare statement the query parameters add', async () => {
    setup({
      ...tab,
      parameters: [
        { name: 'Upn', type: 'string', value: 'alice@example.com' },
        { name: 'Since', type: 'datetime', value: '2026-10-01T00:00:00Z' },
      ],
    });

    // The declare statement is the api's.
    await vi.waitFor(() =>
      expect(lines()).toEqual(['declare query_parameters(Upn:string, Since:datetime);', KQL]),
    );
    const [declare, query] = within(screen.getByRole('list', { name: 'Query' })).getAllByRole(
      'listitem',
    );
    expect(declare).toHaveAccessibleDescription('Line 1 is added from the query parameters');
    expect(query).not.toHaveAccessibleDescription();
    expect(declared).toEqual([
      {
        key: 'tim.run_kql',
        parameters: [
          { name: 'Upn', type: 'string' },
          { name: 'Since', type: 'datetime' },
        ],
      },
    ]);
  });

  it('shows a query a line each, with no declare statement when it has no query parameters', () => {
    const kql = 'SigninLogs\n| take 10';
    setup({ ...tab, kql });
    expect(lines()).toEqual(['SigninLogs', '| take 10']);
    expect(screen.queryByText('Line 1 is added from the query parameters')).not.toBeInTheDocument();
  });

  it('drops the declare statement when the api refuses it', async () => {
    setup({ ...tab, parameters: [{ name: 'Upn', type: 'string', value: 'alice@example.com' }] });
    await vi.waitFor(() => expect(lines()).toHaveLength(2));

    const name = within(parameter(1)).getByRole('combobox', { name: 'Name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'a b');
    await vi.waitFor(() =>
      expect(declared.at(-1)?.parameters).toEqual([{ name: 'a b', type: 'string' }]),
    );
    await vi.waitFor(() => expect(lines()).toEqual([KQL]));
  });

  it('shows a Run SQL query, which declares nothing', () => {
    const SQL = 'SELECT * FROM SIGNINS WHERE UPN = :1';
    setup(
      {
        connection: 'warehouse',
        sql: SQL,
        parameters: [{ name: 'upn', type: 'string', value: 'alice@example.com' }],
      },
      runSql,
    );
    expect(lines()).toEqual([SQL]);
  });

  it('says there is no query yet when the tab has none and declares nothing', () => {
    setup({ connection: 'security', database: 'Samples' });
    expect(screen.queryByRole('list', { name: 'Query' })).not.toBeInTheDocument();
    expect(screen.getByText('No query yet')).toBeInTheDocument();
  });

  it('is not shown for an action without a query', () => {
    const signIns: CatalogueAction = {
      ...runKql,
      params: [{ name: 'users', kind: 'string', required: true, many: true, fromColumns: ['U'] }],
    };
    setup({ users: [] }, signIns);
    expect(screen.queryByRole('list', { name: 'Query' })).not.toBeInTheDocument();
  });

  it('lists the other params saved as they are under the inputs', () => {
    const { dialog } = setup(tab);
    expect(
      within(dialog).getByText('Also saved: connection: security · database: Samples'),
    ).toBeInTheDocument();
  });
});

describe('SavePresetDialog menu folder', () => {
  const inFolder = (presetId: string, menuPath: string[]): Preset => ({
    presetId,
    name: presetId,
    title: presetId,
    menuPath,
    owner: 'bob@example.com',
    visibility: 'shared',
    owned: false,
    hidden: false,
    action: 'tim.run_kql',
    params: {},
    inputs: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  });
  const folder = () => screen.getByRole('combobox', { name: 'Menu folder' });
  const options = () => screen.getAllByRole('option').map((o) => o.textContent);

  beforeEach(() =>
    useInstanceStore.setState({
      instance: {
        version: 'v1',
        actions: [
          { ...runKql, key: 'a', menuPath: ['Development', 'Rows'] },
          { ...runKql, key: 'b', menuPath: ['Security'] },
        ],
        connections: [],
        labels: [],
        limits: {
          maxResultRows: 1,
          maxResultBytes: 1,
          maxPivotRows: 100,
          rowsPageSize: 1,
          runTimeoutSeconds: 1,
          maxAnnotationIds: 10_000,
          annotationPollSeconds: 30,
        },
      },
    }),
  );
  afterEach(() => useInstanceStore.setState({ instance: null }));

  it('offers the existing folders a level at a time, and takes a typed one', async () => {
    const { saved, dialog } = setup(tab, runKql, null, undefined, [
      inFolder('p-2', ['Development', 'Mine']),
    ]);

    await userEvent.click(folder());
    await vi.waitFor(() => expect(options()).toEqual(['Development', 'Security']));
    await userEvent.click(screen.getByRole('option', { name: 'Development' }));
    await userEvent.click(folder());
    expect(options()).toEqual(['Mine', 'Rows']);
    await userEvent.type(folder(), 'Sign-ins{Enter}');
    expect(within(dialog).getByText('Development')).toBeInTheDocument();
    expect(within(dialog).getByText('Sign-ins')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.menuPath).toEqual(['Development', 'Sign-ins']);
  });

  it('starts at the preset’s folder, and Backspace goes up a level', async () => {
    const mine = { ...inFolder('p-1', ['Development', 'Rows']), owned: true };
    const { saved, dialog } = setup(tab, runKql, null, mine);
    expect(within(dialog).getByText('Development')).toBeInTheDocument();
    expect(within(dialog).getByText('Rows')).toBeInTheDocument();

    await userEvent.click(folder());
    await userEvent.keyboard('{Backspace}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save as new' }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.menuPath).toEqual(['Development']);
  });

  it('is the action’s folder for a new preset', async () => {
    const { saved, dialog } = setup(tab, { ...runKql, menuPath: ['Queries'] });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.menuPath).toEqual(['Queries']);
  });
});

describe('SavePresetDialog sharing', () => {
  it('is private until Share with everyone is switched on', async () => {
    const { saved, dialog } = setup(tab);
    const share = within(dialog).getByRole('switch', { name: 'Share with everyone' });
    expect(share).not.toBeChecked();
    await userEvent.click(share);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.visibility).toBe('shared');
  });
});
