import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CatalogueAction, Preset, PresetFields } from '../../lib/api';
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

const KQL = 'SigninLogs | where UserPrincipalName == Upn and TimeGenerated > Since';
const tab = { connection: 'security', database: 'Samples', kql: KQL };

/** The presets API, keeping what was saved. */
function setup(params: Record<string, unknown>) {
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
      action={runKql}
      params={params}
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

    expect(lines()).toEqual([
      'Connection = security',
      'Database = Samples',
      'declare query_parameters(Upn:string, Since:datetime, States:dynamic);',
      `Query = ${KQL}`,
      'Upn = <UserPrincipalName or Upn of the clicked row>',
      'Since = datetime(2026-10-01T00:00:00Z)',
      'States = dynamic(["TEXAS","FLORIDA"])',
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

    await userEvent.clear(name);
    await userEvent.type(name, 'a b');
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
});
