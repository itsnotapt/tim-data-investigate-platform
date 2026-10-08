import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiUrl, makeRun } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { useTabsStore } from '../tabs/tabStore';
import { useTemplatesStore } from '../templates';
import ShareQueryPage from './ShareQueryPage';
import { encodeShareParams } from './shareLink';

const server = setupMswServer();
const queries: Record<string, unknown>[] = [];

const template = {
  uuid: 't1',
  menu: 'm',
  summary: 'User {{user}}',
  path: 'p',
  cluster: 'c',
  database: 'Db',
  query: 'T | where User == {{str user}}',
  params: { user: { default: '' } },
};

function Loc() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="share/:uuid" element={<ShareQueryPage />} />
        <Route path="view/:uuid" element={<Loc />} />
      </Routes>
    </MemoryRouter>,
  );
}

const link = (params: Record<string, unknown>, execute = 0, uuid = 't1') =>
  `/share/${uuid}?p=${encodeURIComponent(encodeShareParams(params))}&execute=${execute}`;

beforeEach(() => {
  configureTestApp();
  queries.length = 0;
  server.use(
    http.post(apiUrl('/api/kusto/query'), async ({ request }) => {
      queries.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(makeRun({ status: 'completed', resultData: [{ a: 1 }] }));
    }),
  );
  useTabsStore.reset();
  useTemplatesStore.setState({ templates: [template] as never, loaded: true });
});
afterEach(resetTestApp);

describe('ShareQueryPage', () => {
  it('shows the not-found error', async () => {
    renderAt(link({}, 0, 'nope'));
    expect(await screen.findByText('This query was not found.')).toBeInTheDocument();
  });

  it('errors when params are missing', async () => {
    renderAt('/share/t1');
    expect(await screen.findByText('Parameters are missing.')).toBeInTheDocument();
  });

  it('errors when params are invalid', async () => {
    renderAt('/share/t1?p=%25%25');
    expect(await screen.findByText('Parameters are invalid.')).toBeInTheDocument();
  });

  it('recreates a root tab in edit mode and navigates, without running (execute=0)', async () => {
    renderAt(link({ user: 'bob 😀', evil: 1 }));
    const loc = await screen.findByTestId('loc');
    const tabs = Object.values(useTabsStore.getState().tabs);
    expect(tabs).toHaveLength(1);
    const tab = tabs[0]!;
    expect(loc).toHaveTextContent(`/view/${tab.componentUuid}`);
    expect(tab.parentUuid).toBeNull();
    expect(tab.title).toBe('User bob 😀');
    expect(tab.componentName === 'TemplateQueryResult' && tab.params.inParams).toEqual({
      user: 'bob 😀',
    });
    expect(tab.state.editQuery).toBe(true);
    expect(queries).toHaveLength(0);
    expect(tab.state.isExecuting).toBe(false);
  });

  it('execute=1 creates the tab and runs it immediately, without a dialog', async () => {
    renderAt(link({ user: 'bob' }, 1));
    await screen.findByTestId('loc');
    expect(screen.queryByText('Run shared query?')).not.toBeInTheDocument();
    const tab = Object.values(useTabsStore.getState().tabs)[0]!;
    expect(tab.state.editQuery).toBe(false);
    await waitFor(() =>
      expect(useTabsStore.getState().tabs[tab.componentUuid]?.state.rowCount).toBe(1),
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ database: 'Db' });
    expect(queries[0]?.['query']).toContain('bob');
  });
});
