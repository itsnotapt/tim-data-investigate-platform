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
  name: 'Run KQL',
  menuPath: [],
  connections: [],
  params: [
    {
      name: 'connection',
      title: 'Connection',
      kind: 'connection',
      connectionType: 'kusto',
      required: true,
      many: false,
    },
    { name: 'database', title: 'Database', kind: 'string', required: true, many: false },
    { name: 'kql', title: 'Query', kind: 'kql', required: true, many: false },
    { name: 'parameters', title: 'Query parameters', kind: 'json', required: false, many: false },
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
      title: 'Connection',
      kind: 'connection',
      connectionType: 'snowflake',
      required: true,
      many: false,
    },
    { name: 'sql', title: 'Query', kind: 'sql', required: true, many: false },
    { name: 'parameters', title: 'Query parameters', kind: 'json', required: false, many: false },
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
      onClose={() => {}}
      store={createPresetsStore({ api })}
    />,
  );
  return { saved, dialog: screen.getByRole('dialog', { name: 'Save preset' }) };
}

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

    // The declare statement is the api's, before the query.
    await vi.waitFor(() =>
      expect(lines()).toEqual([
        'Connection = security',
        'Database = Samples',
        'declare query_parameters(Upn:string, Since:datetime, States:dynamic);',
        `Query = ${KQL}`,
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
      'Connection = warehouse',
      `Query = ${SQL}`,
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
