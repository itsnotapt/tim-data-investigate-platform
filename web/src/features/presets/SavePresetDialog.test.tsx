import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueAction, Preset, PresetFields } from '../../lib/api';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
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

/** The presets API, keeping what was saved. */
function setup(
  params: Record<string, unknown>,
  action: CatalogueAction = runKql,
  idColumn: string | null = null,
  source?: Preset,
) {
  const saved: PresetFields[] = [];
  const api = {
    list: () => Promise.resolve([]),
    create: (fields: PresetFields) => {
      saved.push(fields);
      return Promise.resolve({ ...fields, presetId: 'p-1' } as Preset);
    },
    replace: () => Promise.reject(new Error('not used')),
    remove: () => Promise.resolve(),
    setHidden: () => Promise.resolve(),
    actionFile: () => Promise.resolve(''),
  };
  render(
    <SavePresetDialog
      action={action}
      params={params}
      idColumn={idColumn}
      source={source}
      onClose={() => {}}
      store={createPresetsStore({ api })}
    />,
  );
  return { saved, dialog: screen.getByRole('dialog', { name: 'Save preset' }) };
}

const tabTitle = () => screen.getByRole('textbox', { name: 'Tab title' });
const parameter = (n: number) => screen.getByRole('group', { name: `Query parameter ${n}` });
const lines = () =>
  within(screen.getByRole('list', { name: 'Preview' }))
    .getAllByRole('listitem')
    .map((e) => e.textContent);

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
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.inputs).toEqual([
      { name: 'users', source: 'param', fixed: true, value: ['alice'] },
      { name: 'hosts', source: 'param', fixed: false, fromColumns: ['Host'] },
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

    await userEvent.click(within(dialog).getByRole('button', { name: 'users from the row' }));
    expect(tabTitle()).toHaveValue('Sign-ins {users} {hosts}');
    await retype(within(dialog).getByRole('textbox', { name: 'Name' }), 'My sign-ins');
    expect(tabTitle()).toHaveValue('My sign-ins {users} {hosts}');

    await retype(tabTitle(), 'Hosts {hosts}');
    await retype(within(dialog).getByRole('textbox', { name: 'Name' }), 'Renamed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'users fixed' }));
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

    await userEvent.click(within(parameter(1)).getByRole('button', { name: 'From row' }));
    await userEvent.type(
      within(parameter(1)).getByRole('textbox', { name: 'Columns' }),
      'UserPrincipalName, Upn',
    );
    expect(tabTitle()).toHaveValue('Run KQL {Upn}');

    // The declare statement is the api's, before the query.
    await vi.waitFor(() =>
      expect(lines()).toEqual([
        'connection = security',
        'database = Samples',
        'declare query_parameters(Upn:string, Since:datetime, States:dynamic);',
        `kql = ${KQL}`,
        'Upn = <UserPrincipalName or Upn of the clicked row>',
        'Since = datetime(2026-10-01T00:00:00Z)',
        'States = dynamic(["TEXAS","FLORIDA"])',
      ]),
    );
    expect(declared).toEqual([
      {
        key: 'tim.run_kql',
        parameters: [
          { name: 'Upn', type: 'string' },
          { name: 'Since', type: 'datetime' },
          { name: 'States', type: 'dynamic' },
        ],
      },
    ]);
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

  it('declares a query parameter named from the query, with a typed value', async () => {
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
    await userEvent.type(value, 'yesterday');

    expect(within(parameter(1)).getByText('Must be an ISO 8601 datetime')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.clear(value);
    await userEvent.type(value, '2026-10-01T00:00:00Z');
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
    expect(await screen.findByText('declare query_parameters(Upn:string);')).toBeInTheDocument();

    await userEvent.clear(name);
    await userEvent.type(name, 'a b');
    // The api refuses the name, so the preview declares nothing.
    await vi.waitFor(() =>
      expect(declared.at(-1)?.parameters).toEqual([{ name: 'a b', type: 'string' }]),
    );
    await vi.waitFor(() => expect(lines().some((l) => l?.startsWith('declare'))).toBe(false));
    expect(
      within(parameter(1)).getByText(
        'Starts with a letter or _ and holds only letters, digits and _',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.click(within(parameter(1)).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(saved[0]).toMatchObject({ params: tab, inputs: [] });
  });

  it('moves a query parameter up, which declares it first', async () => {
    const { saved, dialog } = setup({
      ...tab,
      parameters: [
        { name: 'Upn', type: 'string', value: 'alice@example.com' },
        { name: 'Within', type: 'timespan', value: 'PT1H' },
      ],
    });

    expect(within(parameter(1)).getByRole('button', { name: 'Move up' })).toBeDisabled();
    await userEvent.click(within(parameter(2)).getByRole('button', { name: 'Move up' }));

    expect(
      await screen.findByText('declare query_parameters(Within:timespan, Upn:string);'),
    ).toBeInTheDocument();
    expect(within(parameter(2)).getByRole('button', { name: 'Move down' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(saved[0]?.inputs?.map((i) => i.name)).toEqual(['Within', 'Upn']);
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
    expect(lines()).toEqual([
      'connection = warehouse',
      `sql = ${SQL}`,
      ':1 since = 2026-10-01T00:00:00Z',
      ':2 upns = ["alice@example.com","bob@example.com"]',
    ]);

    await userEvent.click(within(parameter(1)).getByRole('button', { name: 'Move down' }));
    await userEvent.click(within(parameter(1)).getByRole('button', { name: 'From row' }));
    await userEvent.type(within(parameter(1)).getByRole('textbox', { name: 'Columns' }), 'UPN');

    expect(within(parameter(1)).getByRole('combobox', { name: 'Name' })).toHaveValue('upns');
    expect(lines().slice(2)).toEqual([
      ':1 upns = <UPN of the clicked row>',
      ':2 since = 2026-10-01T00:00:00Z',
    ]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(saved[0]?.inputs?.map((i) => i.name)).toEqual(['upns', 'since']);
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
