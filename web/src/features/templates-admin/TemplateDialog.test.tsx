import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { SnackbarHost } from '../../components';
import { createApiClient, type QueryTemplate } from '../../lib/api';
import { apiUrl, problemResponse, TEST_API } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { TemplateDialog } from './TemplateDialog';

vi.mock('../../components/CodeEditor', async () =>
  (await import('./testUtils')).fakeCodeEditorModule(),
);

const server = setupMswServer();
const client = createApiClient({ baseUrl: TEST_API, getToken: () => Promise.resolve('t') });

const existing: QueryTemplate = {
  uuid: '3f0c2a52-6d0e-4a1b-9a57-0d2d6b8f1c11',
  name: 'Children',
  isDeleted: false,
  isManaged: false,
  queryType: 'query',
  menu: 'Show children',
  summary: 'Children of {{Id}}',
  path: ['Machine', 'Windows'],
  cluster: 'https://c.kusto.windows.net',
  database: 'Db',
  columnId: 'EventId',
  params: { Id: { type: 'string' } },
  fields: { Id: { type: 'multiple', from: 'Id' } },
  columns: null,
  query: 'T | take 1',
  createdBy: 'alice',
  updatedBy: 'alice',
  updated: '2026-01-01T00:00:00Z',
};

function setup(template: QueryTemplate | null, onSaved = vi.fn()) {
  const onClose = vi.fn();
  render(
    <SnackbarHost>
      <TemplateDialog template={template} client={client} onClose={onClose} onSaved={onSaved} />
    </SnackbarHost>,
  );
  return { onClose, onSaved, user: userEvent.setup() };
}

describe('TemplateDialog', () => {
  it('creates with POST, never sending createdBy', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(apiUrl('/api/templates/queries'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...existing, ...body }, { status: 201 });
      }),
    );
    const { user, onSaved } = setup(null);
    await user.type(screen.getByLabelText(/^Name/), 'New');
    await user.type(screen.getByLabelText(/^Menu text/), 'Menu');
    await user.type(screen.getByLabelText(/^Summary text/), 'Sum');
    await user.type(screen.getByLabelText(/^Cluster/), 'c.kusto.windows.net');
    await user.type(screen.getByLabelText(/^Database/), 'Db');
    await user.type(screen.getByLabelText('Path'), 'a{Enter}b{Enter}');
    await user.type(screen.getByRole('textbox', { name: 'Query' }), 'T');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(body).toMatchObject({ name: 'New', path: ['a', 'b'], queryType: 'view', query: 'T' });
    expect(body).not.toHaveProperty('createdBy');
    expect(body?.uuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('edits with PUT to the template uuid', async () => {
    let url = '';
    server.use(
      http.put(apiUrl('/api/templates/queries/:uuid'), async ({ request }) => {
        url = new URL(request.url).pathname;
        return HttpResponse.json(await request.json());
      }),
    );
    const { user, onSaved } = setup(existing);
    expect(screen.getByText('Edit Query')).toBeInTheDocument();
    expect(screen.getByLabelText('Params')).toHaveValue('Id:\n  type: string\n');
    await user.clear(screen.getByLabelText(/^Name/));
    await user.type(screen.getByLabelText(/^Name/), 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(url).toBe(`/api/templates/queries/${existing.uuid}`);
  });

  it('shows invalid YAML under the editor and does not call the API', async () => {
    const onPut = vi.fn();
    server.use(http.put(apiUrl('/api/templates/queries/:uuid'), onPut));
    const { user } = setup(existing);
    const params = screen.getByLabelText('Params');
    await user.clear(params);
    await user.click(params);
    await user.paste('a: [1, 2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/flow|end of the stream|YAML/i);
    expect(onPut).not.toHaveBeenCalled();
  });

  it('makes a managed template fully read-only, including Fields', () => {
    setup({ ...existing, isManaged: true });
    expect(screen.getByText('This query is being managed by source control.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toBeDisabled();
    for (const label of ['Params', 'Fields', 'Column customisation', 'Query']) {
      expect(screen.getByRole('textbox', { name: label })).toHaveAttribute('readonly');
    }
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows the problem detail from the API', async () => {
    server.use(
      http.put(apiUrl('/api/templates/queries/:uuid'), () =>
        problemResponse(400, { detail: 'Validation failed', errors: { name: ['is bad'] } }),
      ),
    );
    const { user, onSaved } = setup(existing);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByText(/Validation failed/);
    expect(alert).toHaveTextContent('name: is bad');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows a network error without crashing', async () => {
    server.use(http.put(apiUrl('/api/templates/queries/:uuid'), () => HttpResponse.error()));
    const { user } = setup(existing);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server could not be reached.');
  });

  it('requires fields for query templates and hides Fields for views', async () => {
    const { user } = setup({ ...existing, fields: null });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Fields are required/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'View' }));
    expect(screen.queryByLabelText('Fields')).not.toBeInTheDocument();
  });

  it('shows the problem detail when creating fails', async () => {
    server.use(
      http.post(apiUrl('/api/templates/queries'), () =>
        problemResponse(400, { detail: 'Validation failed', errors: { name: ['is bad'] } }),
      ),
    );
    const { user, onSaved } = setup(null);
    await user.type(screen.getByLabelText(/^Name/), 'New');
    await user.type(screen.getByLabelText(/^Menu text/), 'Menu');
    await user.type(screen.getByLabelText(/^Summary text/), 'Sum');
    await user.type(screen.getByLabelText(/^Cluster/), 'c.kusto.windows.net');
    await user.type(screen.getByLabelText(/^Database/), 'Db');
    await user.type(screen.getByLabelText('Path'), 'a{Enter}');
    await user.type(screen.getByRole('textbox', { name: 'Query' }), 'T');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    const alert = await screen.findByText(/Validation failed/);
    expect(alert).toHaveTextContent('name: is bad');
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });
});
