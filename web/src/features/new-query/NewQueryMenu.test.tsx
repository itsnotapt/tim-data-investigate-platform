import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { newTestStore } from '../../test/tabsTestUtils';
import { DEFAULT_QUERY_EXAMPLE } from '../kusto-query/defaultQuery';
import { NewQueryMenu } from './NewQueryMenu';
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

const Loc = () => <div data-testid="loc">{useLocation().pathname}</div>;
function setup() {
  const store = newTestStore();
  render(
    <MemoryRouter>
      <NewQueryMenu templates={templates} queryOptions={{ '3': { hide: true } }} store={store}>
        New
      </NewQueryMenu>
      <Routes>
        <Route path="*" element={<Loc />} />
      </Routes>
    </MemoryRouter>,
  );
  return store;
}

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
});
