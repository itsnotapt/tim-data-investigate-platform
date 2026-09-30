import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SnackbarHost } from '../../components';
import { createApiClient, type QueryTemplate } from '../../lib/api';
import { apiUrl, TEST_API } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { createTemplatesStore } from '../templates';
import QueryManagerPage from './QueryManagerPage';
import { selectionCounts } from './queryManagerState';

vi.mock('../../components/CodeEditor', async () =>
  (await import('./testUtils')).fakeCodeEditorModule(),
);

const server = setupMswServer();
const client = createApiClient({ baseUrl: TEST_API, getToken: () => Promise.resolve('t') });

const tpl = (n: string, extra: Partial<QueryTemplate> = {}): QueryTemplate => ({
  uuid: `00000000-0000-4000-8000-00000000000${n}`,
  name: `Tpl ${n}`,
  isDeleted: false,
  isManaged: false,
  queryType: 'view',
  menu: `Menu ${n}`,
  summary: 's',
  path: ['P'],
  cluster: 'c',
  database: 'd',
  query: 'q',
  createdBy: 'a',
  updatedBy: 'a',
  updated: '2026-01-01T00:00:00Z',
  ...extra,
});

let data: QueryTemplate[];
let calls: string[];
let listQueries: string[];

beforeEach(() => {
  data = [tpl('1'), tpl('2', { isManaged: true }), tpl('3', { isDeleted: true })];
  calls = [];
  listQueries = [];
  server.use(
    http.get(apiUrl('/api/templates/queries'), ({ request }) => {
      const url = new URL(request.url);
      listQueries.push(url.search);
      const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
      return HttpResponse.json(data.filter((t) => includeDeleted || !t.isDeleted));
    }),
    http.delete(apiUrl('/api/templates/queries/:uuid'), ({ params }) => {
      calls.push(`DELETE ${String(params.uuid)}`);
      data = data.map((t) => (t.uuid === params.uuid ? { ...t, isDeleted: true } : t));
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch(apiUrl('/api/templates/queries/:uuid'), async ({ params, request }) => {
      calls.push(`PATCH ${String(params.uuid)} ${JSON.stringify(await request.json())}`);
      data = data.map((t) => (t.uuid === params.uuid ? { ...t, isDeleted: false } : t));
      return HttpResponse.json(data.find((t) => t.uuid === params.uuid));
    }),
  );
});

async function setup() {
  const store = createTemplatesStore({
    fetchTemplates: () => Promise.resolve([]),
    loadQueryOptions: () => Promise.resolve({}),
  });
  const reload = vi.spyOn(store.getState(), 'reload');
  store.setState({ reload });
  render(
    <SnackbarHost>
      <QueryManagerPage client={client} store={store} />
    </SnackbarHost>,
  );
  await screen.findByText('Tpl 1');
  return { user: userEvent.setup(), reload };
}

const row = (name: string) => screen.getByRole('checkbox', { name: `Select ${name}` });

describe('QueryManagerPage', () => {
  it('lists templates with legacy columns, hiding deleted by default', async () => {
    await setup();
    expect(listQueries[0]).toContain('includeDeleted=true');
    for (const h of ['Name', 'Type', 'Menu text', 'Last Updated', 'Path', 'Cluster']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    expect(screen.queryByText('Tpl 3')).not.toBeInTheDocument();
  });

  it('Show deleted reveals deleted rows (no link) and the Restore button', async () => {
    const { user } = await setup();
    expect(screen.queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Show deleted' }));
    expect(screen.getByText('Tpl 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tpl 3' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tpl 1' })).toBeInTheDocument();
  });

  it('filters rows', async () => {
    const { user } = await setup();
    await user.type(screen.getByLabelText('Filter'), 'menu 2');
    expect(screen.queryByText('Tpl 1')).not.toBeInTheDocument();
    expect(screen.getByText('Tpl 2')).toBeInTheDocument();
  });

  it('enables Restore from the restore count, not the delete count (BUG-24)', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('switch', { name: 'Show deleted' }));
    const restore = () => screen.getByRole('button', { name: /^Restore/ });
    const del = () => screen.getByRole('button', { name: /^Delete/ });
    expect(restore()).toBeDisabled();
    await user.click(row('Tpl 3'));
    expect(restore()).toBeEnabled();
    expect(restore()).toHaveTextContent('Restore (1)');
    expect(del()).toBeDisabled();
    await user.click(row('Tpl 3'));
    await user.click(row('Tpl 1'));
    expect(restore()).toBeDisabled();
    expect(del()).toBeEnabled();
  });

  it('disables Delete when a managed template is selected', async () => {
    const { user } = await setup();
    await user.click(row('Tpl 1'));
    expect(screen.getByRole('button', { name: 'Delete (1)' })).toBeEnabled();
    await user.click(row('Tpl 2'));
    expect(screen.getByRole('button', { name: 'Delete (2)' })).toBeDisabled();
  });

  it('bulk deletes, then refreshes the list and the templates store', async () => {
    const { user, reload } = await setup();
    await user.click(row('Tpl 1'));
    await user.click(screen.getByRole('button', { name: 'Delete (1)' }));
    await waitFor(() => expect(screen.queryByText('Tpl 1')).not.toBeInTheDocument());
    expect(calls).toEqual([`DELETE ${data[0]?.uuid}`]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Delete (0)' })).toBeDisabled();
  });

  it('bulk restores with PATCH isDeleted=false', async () => {
    const { user, reload } = await setup();
    await user.click(screen.getByRole('switch', { name: 'Show deleted' }));
    await user.click(row('Tpl 3'));
    await user.click(screen.getByRole('button', { name: 'Restore (1)' }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(calls[0]).toContain('PATCH');
    expect(calls[0]).toContain('"path":"/isDeleted","value":false');
    expect(
      within(screen.getByRole('table')).getByRole('button', { name: 'Tpl 3' }),
    ).toBeInTheDocument();
  });

  it('opens the dialog to create and to edit', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText('Create Query')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Tpl 1' }));
    expect(screen.getByText('Edit Query')).toBeInTheDocument();
  });
});

describe('selectionCounts', () => {
  it('splits delete/restore rows', () => {
    const c = selectionCounts([tpl('1'), tpl('3', { isDeleted: true })]);
    expect([c.delete, c.restore, c.hasManaged]).toEqual([1, 1, false]);
  });
});
