import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { newTestStore } from '../../test/tabsTestUtils';
import { useInstanceStore } from '../instance';
import { DEFAULT_QUERY_EXAMPLE } from '../kusto-query/defaultQuery';
import { NewQueryMenu } from './NewQueryMenu';
import type { CatalogueAction } from '../../lib/api';
import type { QueryTemplate } from './types';

const base = {
  cluster: 'c',
  database: 'd',
  isDeleted: false,
  isManaged: false,
  createdBy: 'x',
  updatedBy: 'x',
  updated: '2024-01-01T00:00:00Z',
  query: 'T | where X == {{Id}}',
  name: 'n',
};
const templates: QueryTemplate[] = [
  {
    ...base,
    uuid: '1',
    menu: 'Children',
    summary: 'Children of {{Id}}',
    path: ['Machine', 'Windows'],
    queryType: 'query',
    params: { Id: { type: 'string', default: 'abc' } },
  },
  {
    ...base,
    uuid: '2',
    menu: 'Logons',
    summary: 'Logons',
    path: ['User', 'Windows'],
    queryType: 'query',
  },
  { ...base, uuid: '3', menu: 'Hidden one', summary: 'h', path: [], queryType: 'view' },
  { ...base, uuid: '4', menu: 'Overview', summary: 'o', path: [], queryType: 'view' },
];

const actions: CatalogueAction[] = [
  {
    key: 'dev-sign-ins',
    kind: 'query',
    actionFile: false,
    name: 'Sign-ins',
    menuPath: ['Identity', 'Entra'],
    connections: [],
    params: [
      { name: 'users', title: 'Users', kind: 'string', required: false, many: true },
      {
        name: 'since',
        title: 'Since',
        kind: 'timespan',
        required: false,
        many: false,
        default: 'PT1H',
      },
    ],
    pivot: null,
  },
  {
    key: 'tim.run_kql',
    kind: 'query',
    actionFile: false,
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
      { name: 'kql', title: 'Query', kind: 'kql', required: true, many: false },
    ],
    pivot: null,
  },
  {
    key: 'dev-slow',
    kind: 'query',
    actionFile: false,
    name: 'Slow',
    menuPath: [],
    connections: [],
    params: [],
    pivot: null,
  },
];

const Loc = () => <div data-testid="loc">{useLocation().pathname}</div>;
function setup() {
  const store = newTestStore();
  render(
    <MemoryRouter>
      <NewQueryMenu
        templates={templates}
        queryOptions={{ '3': { hide: true } }}
        actions={actions}
        store={store}
      >
        New
      </NewQueryMenu>
      <Routes>
        <Route path="*" element={<Loc />} />
      </Routes>
    </MemoryRouter>,
  );
  return store;
}

afterEach(() => useInstanceStore.setState({ instance: null }));

describe('NewQueryMenu', () => {
  it('creates an ad-hoc draft with the default query and navigates', async () => {
    const store = setup();
    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'New query' }));
    const [tab] = Object.values(store.getState().tabs);
    expect(tab?.componentName).toBe('KustoQueryResult');
    expect(tab?.title).toBe('New query');
    expect(tab?.parentUuid).toBeNull();
    expect(tab?.params).toEqual({ query: DEFAULT_QUERY_EXAMPLE, cluster: '', database: '' });
    expect(tab?.state.rowCount).toBeNull();
    expect(screen.getByTestId('loc')).toHaveTextContent(`/view/${tab?.componentUuid}`);
  });

  it('hides hidden templates and lists Views / Queries', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    await userEvent.click(screen.getByText('Views'));
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.queryByText('Hidden one')).not.toBeInTheDocument();
  });

  it('opens a template tab with default params in edit mode', async () => {
    const store = setup();
    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    await userEvent.click(screen.getByText('Queries'));
    await userEvent.click(screen.getByText('Machine'));
    await userEvent.click(screen.getByText('Windows'));
    await userEvent.click(screen.getByText('Children'));
    const [tab] = Object.values(store.getState().tabs);
    expect(tab?.componentName).toBe('TemplateQueryResult');
    expect(tab?.title).toBe('Children of {{Id}}');
    expect(tab?.params).toMatchObject({ inParams: { Id: 'abc' } });
    expect(tab?.state.editQuery).toBe(true);
    expect(screen.getByTestId('loc')).toHaveTextContent(`/view/${tab?.componentUuid}`);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('search is case-insensitive, expands groups and keeps same-named folders apart', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    await userEvent.type(screen.getByLabelText('Search queries'), 'LOG');
    expect(screen.getByText('Logons')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.queryByText('Machine')).not.toBeInTheDocument();
    expect(screen.queryByText('Views')).not.toBeInTheDocument();
  });

  it('opens an action under its menu path as an action tab with its defaults, and focuses it', async () => {
    const store = setup();
    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    await userEvent.click(screen.getByText('Actions and presets'));
    expect(screen.getByText('Slow')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Identity'));
    await userEvent.click(screen.getByText('Entra'));
    await userEvent.click(screen.getByText('Sign-ins'));
    const [tab] = Object.values(store.getState().tabs);
    expect(tab?.componentName).toBe('ActionResult');
    expect(tab?.title).toBe('Sign-ins');
    expect(tab?.params).toEqual({ action: 'dev-sign-ins', params: { since: 'PT1H' } });
    expect(screen.getByTestId('loc')).toHaveTextContent(`/view/${tab?.componentUuid}`);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('fills in a connection param that has only one choice', async () => {
    useInstanceStore.setState({
      instance: {
        version: 'v1',
        actions,
        connections: [{ name: 'security', type: 'kusto', title: 'Security' }],
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
    });
    const store = setup();
    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    await userEvent.click(screen.getByText('Actions and presets'));
    await userEvent.click(screen.getByText('Run KQL'));
    const [tab] = Object.values(store.getState().tabs);
    expect(tab?.params).toEqual({ action: 'tim.run_kql', params: { connection: 'security' } });
  });

  it('search finds actions by name and folder', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    await userEvent.type(screen.getByLabelText('Search queries'), 'entra');
    expect(screen.getByText('Sign-ins')).toBeInTheDocument();
    expect(screen.queryByText('Slow')).not.toBeInTheDocument();
  });
});
