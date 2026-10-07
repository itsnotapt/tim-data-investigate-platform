import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ClusterSelect } from './ClusterSelect';
import { databasesFor, validateClusterSelection, type ClusterGroup } from './clusterSelection';

const groups: ClusterGroup[] = [
  { name: 'Prod', clusters: ['https://a.kusto.windows.net'], databases: ['Db1', 'Db2'] },
  { name: 'Fabric', clusters: ['https://b.kusto.fabric.microsoft.com'], databases: ['Lake'] },
];

function Harness({ showErrors = false, initial = { cluster: '', database: '' } }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <ClusterSelect
        groups={groups}
        showErrors={showErrors}
        cluster={v.cluster}
        database={v.database}
        onClusterChange={(cluster) => setV((s) => ({ ...s, cluster }))}
        onDatabaseChange={(database) => setV((s) => ({ ...s, database }))}
      />
      <output data-testid="v">{JSON.stringify(v)}</output>
    </>
  );
}
const value = () => JSON.parse(screen.getByTestId('v').textContent) as Record<string, string>;

describe('ClusterSelect', () => {
  it('lists clusters grouped by name and fills the group databases', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox', { name: /Cluster/ }));
    expect(screen.getByText('Prod')).toBeVisible();
    expect(screen.getByText('Fabric')).toBeVisible();
    await user.click(screen.getByRole('option', { name: 'https://a.kusto.windows.net' }));
    expect(value().cluster).toBe('https://a.kusto.windows.net');

    await user.click(screen.getByRole('combobox', { name: /Database/ }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Db1', 'Db2']);
    await user.click(screen.getByRole('option', { name: 'Db2' }));
    expect(value().database).toBe('Db2');
  });

  it('accepts free text and normalises without forcing .kusto.windows.net', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox', { name: /Cluster/ }), 'other.example.org');
    await user.type(screen.getByRole('combobox', { name: /Database/ }), 'Custom');
    // Moving to the database field blurred the cluster field, which normalises it.
    expect(value()).toEqual({ cluster: 'https://other.example.org', database: 'Custom' });
    expect(screen.getByRole('combobox', { name: /Database/ })).toHaveValue('Custom');
  });

  it('shows the required errors', () => {
    render(<Harness showErrors />);
    expect(screen.getByText('Cluster is required')).toBeVisible();
    expect(screen.getByText('Database is required')).toBeVisible();
  });
});

describe('cluster helpers', () => {
  it('validates required fields', () => {
    expect(validateClusterSelection('', ' ')).toEqual([
      'Cluster is required',
      'Database is required',
    ]);
    expect(validateClusterSelection('c', 'd')).toEqual([]);
  });
  it('finds databases by group, ignoring a missing scheme or trailing slash', () => {
    expect(databasesFor(groups, 'b.kusto.fabric.microsoft.com/')).toEqual(['Lake']);
    expect(databasesFor(groups, 'unknown')).toEqual([]);
    expect(databasesFor(groups, '')).toEqual([]);
  });
});
