import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueParam, InstanceConnection } from '../../lib/api';
import { type Notify, NotifyContext } from '../../components/notifyContext';
import { PillsBar } from './PillsBar';

const param = (
  p: Partial<CatalogueParam> & Pick<CatalogueParam, 'name' | 'kind'>,
): CatalogueParam => ({
  required: false,
  many: false,
  ...p,
});

const connections: InstanceConnection[] = [
  { name: 'prod', type: 'kusto', title: 'Production', databases: ['Samples', 'Logs'] },
  { name: 'test', type: 'kusto', title: 'Test' },
  { name: 'wh', type: 'snowflake', title: 'Warehouse' },
];

/** The bar over local values, which it shows as JSON so a test can read what was committed. */
function Harness({
  params,
  initial = {},
  needed,
}: {
  params: CatalogueParam[];
  initial?: Record<string, unknown>;
  needed?: string[];
}) {
  const [values, setValues] = useState(initial);
  return (
    <>
      <PillsBar
        params={params}
        values={values}
        connections={connections}
        needed={needed}
        onChange={(name, value) =>
          setValues((v) => {
            const next = { ...v };
            if (value === undefined) delete next[name];
            else next[name] = value;
            return next;
          })
        }
      />
      <output data-testid="values">{JSON.stringify(values)}</output>
    </>
  );
}

const values = () => JSON.parse(screen.getByTestId('values').textContent ?? '{}') as unknown;
const openPill = (name: RegExp) => userEvent.click(screen.getByRole('button', { name }));
const popover = () => screen.getByRole('dialog');

describe('PillsBar', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows one pill per param except the editor params, named as written, with its value', () => {
    render(
      <Harness
        params={[
          param({ name: 'user_principal_name', kind: 'string', many: true }),
          param({ name: 'kql', kind: 'kql' }),
          param({ name: 'process_guid', kind: 'string' }),
        ]}
        initial={{ user_principal_name: ['alice', 'bob'] }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'user_principal_name: alice, bob' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'process_guid: not set' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /kql/ })).not.toBeInTheDocument();
  });

  it('switches a boolean param', async () => {
    render(<Harness params={[param({ name: 'blocked', kind: 'boolean' })]} />);
    await openPill(/blocked/);
    await userEvent.click(within(popover()).getByRole('switch', { name: 'blocked' }));
    expect(values()).toEqual({ blocked: true });
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'blocked: on' })).toBeInTheDocument();
  });

  it('splits pasted text into chips for a many-valued param, and removes a chip', async () => {
    render(<Harness params={[param({ name: 'users', kind: 'string', many: true })]} />);
    await openPill(/users/);
    const input = within(popover()).getByRole('textbox', { name: 'Add users' });
    fireEvent.paste(input, {
      clipboardData: { getData: () => 'alice@example.com\nbob@example.com, carol@example.com\n' },
    });
    expect(values()).toEqual({
      users: ['alice@example.com', 'bob@example.com', 'carol@example.com'],
    });
    await userEvent.type(input, 'dave{Enter}');
    expect(values()).toEqual({
      users: ['alice@example.com', 'bob@example.com', 'carol@example.com', 'dave'],
    });
    const bob = within(popover()).getByRole('button', { name: 'bob@example.com' });
    bob.focus();
    await userEvent.keyboard('{Delete}');
    expect(values()).toEqual({ users: ['alice@example.com', 'carol@example.com', 'dave'] });
  });

  it('converts each chip of a many-valued number param', async () => {
    render(<Harness params={[param({ name: 'ports', kind: 'number', many: true })]} />);
    await openPill(/ports/);
    const input = within(popover()).getByRole('textbox', { name: 'Add ports' });
    fireEvent.paste(input, { clipboardData: { getData: () => '80\t443' } });
    expect(values()).toEqual({ ports: [80, 443] });
  });

  it('picks a choice, and clears it', async () => {
    render(
      <Harness params={[param({ name: 'level', kind: 'string', choices: ['low', 'high'] })]} />,
    );
    await openPill(/level/);
    await userEvent.click(within(popover()).getByRole('option', { name: 'high' }));
    expect(values()).toEqual({ level: 'high' });
    await openPill(/level: high/);
    await userEvent.click(within(popover()).getByRole('option', { name: 'Not set' }));
    expect(values()).toEqual({});
  });

  it('picks several choices of a many-valued param', async () => {
    render(
      <Harness
        params={[
          param({
            name: 'level',
            kind: 'string',
            many: true,
            choices: ['low', 'mid', 'high'],
          }),
        ]}
      />,
    );
    await openPill(/level/);
    await userEvent.click(within(popover()).getByRole('option', { name: 'high' }));
    await userEvent.click(within(popover()).getByRole('option', { name: 'low' }));
    expect(values()).toEqual({ level: ['low', 'high'] });
  });

  it('picks a connection of the param’s connection type by its title', async () => {
    render(
      <Harness
        params={[
          param({
            name: 'connection',
            kind: 'connection',
            connectionType: 'kusto',
          }),
        ]}
      />,
    );
    await openPill(/connection/);
    expect(within(popover()).queryByRole('option', { name: 'Warehouse' })).not.toBeInTheDocument();
    await userEvent.click(within(popover()).getByRole('option', { name: 'Test' }));
    expect(values()).toEqual({ connection: 'test' });
    expect(screen.getByRole('button', { name: 'connection: Test' })).toBeInTheDocument();
  });

  it('greys out a connection pill with only one choice', async () => {
    render(
      <Harness
        params={[
          param({
            name: 'warehouse',
            kind: 'connection',
            connectionType: 'snowflake',
          }),
        ]}
        initial={{ warehouse: 'wh' }}
      />,
    );
    const pill = screen.getByRole('button', { name: 'warehouse: Warehouse' });
    expect(pill).toHaveAttribute('aria-disabled', 'true');
    await userEvent.setup({ pointerEventsCheck: 0 }).click(pill);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('suggests the chosen connection’s databases for the query’s database param', async () => {
    render(
      <Harness
        params={[
          param({ name: 'connection', kind: 'connection', connectionType: 'kusto' }),
          param({ name: 'database', kind: 'string' }),
          param({ name: 'kql', kind: 'kql', schemaFrom: ['connection', 'database'] }),
        ]}
        initial={{ connection: 'prod' }}
      />,
    );
    await openPill(/database/);
    await userEvent.click(screen.getByRole('option', { name: 'Logs' }));
    expect(values()).toEqual({ connection: 'prod', database: 'Logs' });

    await openPill(/database/);
    const typed = within(popover()).getByRole('combobox', { name: 'database' });
    await userEvent.clear(typed);
    await userEvent.type(typed, 'Other');
    expect(values()).toEqual({ connection: 'prod', database: 'Other' });
  });

  it.each([
    ['number', 'limit', '42', 42, 'abc', 'Must be a number'],
    ['string', 'user', 'alice', 'alice', null, null],
  ] as const)('edits a %s param as text', async (kind, name, good, parsed, bad, message) => {
    render(<Harness params={[param({ name, kind })]} />);
    await openPill(new RegExp(name));
    const input = within(popover()).getByRole('textbox', { name });
    await userEvent.type(input, good);
    expect(values()).toEqual({ [name]: parsed });
    if (bad === null) return;
    await userEvent.clear(input);
    expect(values()).toEqual({});
    await userEvent.type(input, bad);
    expect(within(popover()).getByText(message)).toBeInTheDocument();
    expect(values()).toEqual({});
  });

  it('sets a datetime in UTC by pasting an ISO datetime, picking a day and an hour', async () => {
    // Today is in the pasted month, so the calendar opens on it.
    vi.useFakeTimers({ now: new Date('2026-10-20T10:00:00Z'), toFake: ['Date'] });
    render(<Harness params={[param({ name: 'since', kind: 'datetime' })]} />);
    await openPill(/since/);
    const field = within(popover()).getByRole('group', { name: 'since (UTC)' });
    fireEvent.paste(field, { clipboardData: { getData: () => '2026-10-01T10:00:00+02:00' } });
    expect(values()).toEqual({ since: '2026-10-01T08:00:00Z' });
    await userEvent.click(within(popover()).getByRole('gridcell', { name: '15' }));
    expect(values()).toEqual({ since: '2026-10-15T08:00:00Z' });
    await userEvent.click(within(popover()).getByRole('option', { name: '21 hours' }));
    expect(values()).toEqual({ since: '2026-10-15T21:00:00Z' });
    await userEvent.keyboard('{Escape}');
    expect(
      screen.getByRole('button', { name: 'since: 2026-10-15 21:00:00 UTC' }),
    ).toBeInTheDocument();
  });

  it('unsets a datetime', async () => {
    render(
      <Harness
        params={[param({ name: 'since', kind: 'datetime' })]}
        initial={{ since: '2026-10-01T08:00:00Z' }}
      />,
    );
    await openPill(/since/);
    await userEvent.click(within(popover()).getByRole('button', { name: 'Not set' }));
    expect(values()).toEqual({});
  });

  it('picks a timespan preset', async () => {
    render(<Harness params={[param({ name: 'window', kind: 'timespan' })]} />);
    await openPill(/window/);
    await userEvent.click(within(popover()).getByRole('button', { name: '7 days' }));
    expect(values()).toEqual({ window: 'P7D' });
    expect(screen.getByRole('button', { name: 'window: 7 days' })).toBeInTheDocument();
  });

  it('sets a timespan as an amount of a unit', async () => {
    render(<Harness params={[param({ name: 'window', kind: 'timespan' })]} />);
    await openPill(/window/);
    const amount = within(popover()).getByRole('spinbutton', { name: 'window' });
    await userEvent.type(amount, '90');
    expect(values()).toEqual({ window: 'PT90M' });
    await userEvent.click(within(popover()).getByRole('combobox', { name: 'Unit' }));
    await userEvent.click(screen.getByRole('option', { name: 'hours' }));
    expect(values()).toEqual({ window: 'PT90H' });
    await userEvent.clear(amount);
    expect(values()).toEqual({});
  });

  it.each([
    ['PT2H', '2', 'hours', 'window: 2 hours'],
    ['01:30:00', '90', 'minutes', 'window: 90 minutes'],
    ['P1DT12H', '36', 'hours', 'window: 36 hours'],
    ['PT1S', '1', 'seconds', 'window: 1 second'],
  ])('shows the timespan %s in its largest whole unit', async (value, amount, unit, pill) => {
    render(
      <Harness
        params={[param({ name: 'window', kind: 'timespan' })]}
        initial={{ window: value }}
      />,
    );
    await openPill(/window/);
    expect(within(popover()).getByRole('spinbutton', { name: 'window' })).toHaveValue(
      Number(amount),
    );
    expect(within(popover()).getByRole('combobox', { name: 'Unit' })).toHaveTextContent(unit);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: pill })).toBeInTheDocument();
  });

  it('edits a JSON param', async () => {
    render(<Harness params={[param({ name: 'rows', kind: 'json' })]} />);
    await openPill(/rows/);
    const input = within(popover()).getByRole('textbox', { name: 'rows' });
    fireEvent.change(input, { target: { value: '[{"User": "alice"}]' } });
    expect(values()).toEqual({ rows: [{ User: 'alice' }] });
    fireEvent.change(input, { target: { value: '[{"User": ' } });
    expect(within(popover()).getByText('Must be JSON')).toBeInTheDocument();
    expect(values()).toEqual({ rows: [{ User: 'alice' }] });
  });

  it('marks a param the server refused, with its reason', () => {
    render(
      <PillsBar
        params={[
          param({ name: 'users', kind: 'string', many: true }),
          param({ name: 'since', kind: 'datetime' }),
        ]}
        values={{}}
        connections={connections}
        onChange={() => {}}
        errors={{ users: 'Required' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'users: not set' })).toHaveAccessibleDescription(
      'Required',
    );
    expect(screen.getByRole('button', { name: 'users: not set' })).toHaveClass(
      'MuiChip-colorError',
    );
    expect(screen.getByRole('button', { name: 'since: not set' })).not.toHaveClass(
      'MuiChip-colorError',
    );
  });

  it('shows Edited when the params differ from the last run, and resets them', async () => {
    const onReset = vi.fn();
    const props = {
      params: [param({ name: 'users', kind: 'string', many: true })],
      values: {},
      connections,
      onChange: () => {},
    };
    const { rerender } = render(<PillsBar {...props} />);
    expect(screen.queryByRole('button', { name: 'Edited' })).not.toBeInTheDocument();
    rerender(<PillsBar {...props} onReset={onReset} />);
    const edited = screen.getByRole('button', { name: 'Edited' });
    expect(edited).toHaveAccessibleDescription('Reset to the params of the last run');
    await userEvent.click(edited);
    expect(onReset).toHaveBeenCalled();
  });

  it('marks the params a waiting pivot needs, and opens the first one at once', async () => {
    render(
      <Harness
        params={[
          param({ name: 'host', kind: 'string' }),
          param({ name: 'result', kind: 'string' }),
          param({ name: 'at', kind: 'string' }),
        ]}
        needed={['result', 'at']}
      />,
    );
    const result = within(popover()).getByRole('textbox', { name: 'result' });
    await userEvent.type(result, 'Failure');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'result: Failure' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'at: needed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'host: not set' })).toBeInTheDocument();
  });

  it.each([
    ['text', param({ name: 'user', kind: 'string' }), 'textbox', 'user'],
    ['number', param({ name: 'limit', kind: 'number' }), 'textbox', 'limit'],
    ['many-valued', param({ name: 'users', kind: 'string', many: true }), 'textbox', 'Add users'],
    ['suggestions', param({ name: 'database', kind: 'string' }), 'combobox', 'database'],
    ['datetime', param({ name: 'since', kind: 'datetime' }), 'spinbutton', 'Year'],
    ['timespan', param({ name: 'window', kind: 'timespan' }), 'spinbutton', 'window'],
    ['boolean', param({ name: 'blocked', kind: 'boolean' }), 'switch', 'blocked'],
  ] as const)(
    'focuses the %s editor’s field once its popover has opened',
    async (_, p, role, name) => {
      render(
        <Harness
          params={[
            param({ name: 'connection', kind: 'connection', connectionType: 'kusto' }),
            p,
            param({ name: 'kql', kind: 'kql', schemaFrom: ['connection', 'database'] }),
          ]}
          initial={{ connection: 'prod' }}
        />,
      );
      await openPill(new RegExp(`^${p.name}:`));
      const field = within(popover()).getByRole(role, { name });
      await waitFor(() => expect(field).toHaveFocus());
    },
  );
});

describe('PillsBar Id column', () => {
  /**
   * The bar with an Id column pill over the results' `columns`, which keeps what it applies.
   * Host has 150 duplicate ids and Device 1.
   */
  function IdColumnHarness({
    apply,
    notify = () => {},
    initial = 'User',
  }: {
    apply: (column: string | null) => void;
    notify?: Notify;
    initial?: string | null;
  }) {
    const [current, setCurrent] = useState<string | null>(initial);
    return (
      <NotifyContext.Provider value={notify}>
        <PillsBar
          params={[param({ name: 'host', kind: 'string' })]}
          values={{}}
          connections={connections}
          onChange={() => {}}
          idColumn={{
            current,
            columns: [
              { name: 'User', duplicates: 0 },
              { name: 'Host', duplicates: 150 },
              { name: 'Device', duplicates: 1 },
              { name: 'Sid', duplicates: 0 },
            ],
            onChange: (column) => {
              apply(column);
              setCurrent(column);
            },
          }}
        />
      </NotifyContext.Provider>
    );
  }

  const idField = () => within(popover()).getByRole('textbox', { name: 'Id column' });
  const columnOption = (name: string | RegExp) =>
    within(within(popover()).getByRole('listbox', { name: 'Columns' })).getByRole('option', {
      name,
    });

  it('shows the results’ Id column after the params, and switches to a picked column at once', async () => {
    const apply = vi.fn();
    render(<IdColumnHarness apply={apply} />);
    const pills = screen.getAllByRole('button').map((b) => b.textContent);
    expect(pills).toEqual(['host: not set', 'Id column: User']);

    await openPill(/^Id column:/);
    await userEvent.click(columnOption(/^Sid/));

    expect(apply).toHaveBeenCalledExactlyOnceWith('Sid');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Id column: Sid' })).toBeInTheDocument();
  });

  it('warns when the Id column has duplicates, with the count', () => {
    render(<IdColumnHarness apply={vi.fn()} initial="Host" />);
    const pill = screen.getByRole('button', { name: 'Id column: Host · 150 duplicates found' });
    expect(pill).toHaveClass('MuiChip-colorWarning');
    expect(pill).toHaveAttribute(
      'title',
      '150 duplicates found in Host, so no row has an id: choose another Id column',
    );
  });

  it('disables each column with duplicates, saying how many, the current one included', async () => {
    const apply = vi.fn();
    render(<IdColumnHarness apply={apply} initial="Host" />);

    await openPill(/^Id column:/);
    expect(columnOption(/^Host/)).toHaveAttribute('aria-disabled', 'true');
    expect(columnOption(/^Host/)).toHaveTextContent('Not valid: 150 duplicates found');
    expect(columnOption(/^Device/)).toHaveTextContent('Not valid: 1 duplicate found');
    expect(columnOption(/^Device/)).toHaveAttribute('aria-disabled', 'true');
    expect(columnOption(/^User/)).not.toHaveAttribute('aria-disabled');
    expect(columnOption(/^User/)).toHaveTextContent(/^User$/);
  });

  it('switches to a typed column when its editor closes, and not when it is unchanged', async () => {
    const apply = vi.fn();
    render(<IdColumnHarness apply={apply} />);

    await openPill(/^Id column:/);
    await userEvent.clear(idField());
    await userEvent.type(idField(), 'Seen');
    expect(apply).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apply).toHaveBeenCalledExactlyOnceWith('Seen');

    await openPill(/^Id column:/);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apply).toHaveBeenCalledOnce();
  });

  it('switches to a typed column on Enter', async () => {
    const apply = vi.fn();
    render(<IdColumnHarness apply={apply} />);

    await openPill(/^Id column:/);
    await userEvent.clear(idField());
    await userEvent.type(idField(), 'Seen{Enter}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apply).toHaveBeenCalledExactlyOnceWith('Seen');
  });

  it('refuses a typed column with duplicates, saying how many', async () => {
    const apply = vi.fn();
    const notify = vi.fn();
    render(<IdColumnHarness apply={apply} notify={notify} />);

    await openPill(/^Id column:/);
    await userEvent.clear(idField());
    await userEvent.type(idField(), 'Host{Enter}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apply).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      'Id column not changed: 150 duplicates found in Host',
    );
    expect(screen.getByRole('button', { name: 'Id column: User' })).toBeInTheDocument();
  });
});
