import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { CatalogueParam, InstanceConnection } from '../../lib/api';
import { PillsBar } from './PillsBar';

const param = (
  p: Partial<CatalogueParam> & Pick<CatalogueParam, 'name' | 'kind'>,
): CatalogueParam => ({
  title: p.name,
  required: false,
  many: false,
  ...p,
});

const connections: InstanceConnection[] = [
  { name: 'prod', type: 'kusto', title: 'Production' },
  { name: 'test', type: 'kusto', title: 'Test' },
  { name: 'wh', type: 'snowflake', title: 'Warehouse' },
];

/** The bar over local values, which it shows as JSON so a test can read what was committed. */
function Harness({
  params,
  initial = {},
}: {
  params: CatalogueParam[];
  initial?: Record<string, unknown>;
}) {
  const [values, setValues] = useState(initial);
  return (
    <>
      <PillsBar
        params={params}
        values={values}
        connections={connections}
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
  it('shows one pill per param except the editor params, with its value', () => {
    render(
      <Harness
        params={[
          param({ name: 'users', kind: 'string', title: 'Users', many: true }),
          param({ name: 'kql', kind: 'kql', title: 'Query' }),
          param({ name: 'since', kind: 'datetime', title: 'Since' }),
        ]}
        initial={{ users: ['alice', 'bob'] }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Users: alice, bob' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Since: not set' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Query/ })).not.toBeInTheDocument();
  });

  it('switches a boolean param', async () => {
    render(<Harness params={[param({ name: 'blocked', kind: 'boolean', title: 'Blocked' })]} />);
    await openPill(/Blocked/);
    await userEvent.click(within(popover()).getByRole('switch', { name: 'Blocked' }));
    expect(values()).toEqual({ blocked: true });
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Blocked: on' })).toBeInTheDocument();
  });

  it('splits pasted text into chips for a many-valued param, and removes a chip', async () => {
    render(
      <Harness params={[param({ name: 'users', kind: 'string', title: 'Users', many: true })]} />,
    );
    await openPill(/Users/);
    const input = within(popover()).getByRole('textbox', { name: 'Add Users' });
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
    render(
      <Harness params={[param({ name: 'ports', kind: 'number', title: 'Ports', many: true })]} />,
    );
    await openPill(/Ports/);
    const input = within(popover()).getByRole('textbox', { name: 'Add Ports' });
    fireEvent.paste(input, { clipboardData: { getData: () => '80\t443' } });
    expect(values()).toEqual({ ports: [80, 443] });
  });

  it('picks a choice, and clears it', async () => {
    render(
      <Harness
        params={[
          param({ name: 'level', kind: 'string', title: 'Level', choices: ['low', 'high'] }),
        ]}
      />,
    );
    await openPill(/Level/);
    await userEvent.click(within(popover()).getByRole('option', { name: 'high' }));
    expect(values()).toEqual({ level: 'high' });
    await openPill(/Level: high/);
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
            title: 'Level',
            many: true,
            choices: ['low', 'mid', 'high'],
          }),
        ]}
      />,
    );
    await openPill(/Level/);
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
            title: 'Connection',
            connectionType: 'kusto',
          }),
        ]}
      />,
    );
    await openPill(/Connection/);
    expect(within(popover()).queryByRole('option', { name: 'Warehouse' })).not.toBeInTheDocument();
    await userEvent.click(within(popover()).getByRole('option', { name: 'Test' }));
    expect(values()).toEqual({ connection: 'test' });
    expect(screen.getByRole('button', { name: 'Connection: Test' })).toBeInTheDocument();
  });

  it.each([
    ['number', 'Limit', '42', 42, 'abc', 'Must be a number'],
    [
      'datetime',
      'Since',
      '2026-10-01T08:00:00Z',
      '2026-10-01T08:00:00Z',
      'yesterday',
      'Must be an ISO 8601 datetime',
    ],
    [
      'timespan',
      'Window',
      'PT1H30M',
      'PT1H30M',
      '90 minutes',
      'Must be an ISO 8601 duration or HH:MM:SS',
    ],
    [
      'timespan',
      'Window',
      '01:30:00',
      '01:30:00',
      '1h',
      'Must be an ISO 8601 duration or HH:MM:SS',
    ],
    ['string', 'User', 'alice', 'alice', null, null],
  ] as const)('edits a %s param as text', async (kind, title, good, parsed, bad, message) => {
    render(<Harness params={[param({ name: 'p', kind, title })]} />);
    await openPill(new RegExp(title));
    const input = within(popover()).getByRole('textbox', { name: title });
    await userEvent.type(input, good);
    expect(values()).toEqual({ p: parsed });
    if (bad === null) return;
    await userEvent.clear(input);
    expect(values()).toEqual({});
    await userEvent.type(input, bad);
    expect(within(popover()).getByText(message)).toBeInTheDocument();
    expect(values()).toEqual({});
  });

  it('edits a JSON param', async () => {
    render(<Harness params={[param({ name: 'rows', kind: 'json', title: 'Rows' })]} />);
    await openPill(/Rows/);
    const input = within(popover()).getByRole('textbox', { name: 'Rows' });
    fireEvent.change(input, { target: { value: '[{"User": "alice"}]' } });
    expect(values()).toEqual({ rows: [{ User: 'alice' }] });
    fireEvent.change(input, { target: { value: '[{"User": ' } });
    expect(within(popover()).getByText('Must be JSON')).toBeInTheDocument();
    expect(values()).toEqual({ rows: [{ User: 'alice' }] });
  });
});
