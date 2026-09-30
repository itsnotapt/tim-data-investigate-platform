import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SnackbarHost } from '../../components/SnackbarHost';
import { resetConfigCache } from '../../lib/config/runtimeConfig';
import { apiUrl, makeRun, TEST_API } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { initAgGrid } from '../grid';
import { decodeShareParams } from '../share/shareLink';
import { useTabsStore } from '../tabs/tabStore';
import { TemplateQueryTab } from './TemplateQueryTab';

vi.mock('../tabs/tabStore', async (importOriginal) => {
  const m = await importOriginal<typeof import('../tabs/tabStore')>();
  const store = m.createTabsStore({
    persistence: {
      loadAll: () => Promise.resolve([]),
      save: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    },
    debounceMs: 1,
  });
  return { ...m, useTabsStore: store };
});
vi.mock('../../lib/api/client', async (orig) => {
  const m = await orig<typeof import('../../lib/api/client')>();
  return {
    ...m,
    getApiClient: () =>
      m.createApiClient({ baseUrl: TEST_API, getToken: () => Promise.resolve('t'), timeoutMs: 0 }),
  };
});
vi.mock('../../components/CodeEditor', () => ({ CodeEditor: () => <div /> }));

const server = setupMswServer();

const template = {
  uuid: 't1',
  menu: 'm',
  summary: 'S',
  path: 'p',
  cluster: 'https://c.kusto.windows.net',
  database: 'Db',
  query: 'T | where User == {{str user}}',
  params: { user: { default: '' } },
};

function Loc() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

beforeEach(() => {
  useTabsStore.reset();
  initAgGrid({});
  window.appConfig = {
    auth: { clientId: 'id', authority: 'https://login.example.com/t' },
    redirectUri: 'https://tim.example.com/blank.html',
    tagCluster: 'https://tags.kusto.windows.net',
  };
  resetConfigCache();
  useTabsStore.getState().createTab({
    componentUuid: 'root',
    componentName: 'KustoQueryResult',
    parentUuid: null,
    title: 'Root',
    params: { query: 'T', cluster: '', database: '' },
  });
  useTabsStore.getState().createTab({
    componentUuid: 'tpl',
    componentName: 'TemplateQueryResult',
    parentUuid: 'root',
    title: 'Logons',
    params: { inParams: { user: 'bob' }, queryTemplate: template },
    state: { editQuery: false },
  });
});

function setup() {
  render(
    <MemoryRouter initialEntries={['/view/tpl']}>
      <SnackbarHost>
        <Routes>
          <Route path="/view/:id" element={<TemplateQueryTab uuid="tpl" />} />
        </Routes>
        <Loc />
      </SnackbarHost>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('TemplateQueryTab actions (P4-19)', () => {
  it('Run Query shows the snackbar, runs, and stores results', async () => {
    server.use(
      http.post(apiUrl('/api/kusto/query'), () =>
        HttpResponse.json(makeRun({ status: 'completed', resultData: [{ a: 1 }] })),
      ),
    );
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Run Query' }));
    expect(await screen.findByText('Executing query...')).toBeInTheDocument();
    await waitFor(() => expect(useTabsStore.getState().tabs['tpl']?.rowDataTrigger).not.toBeNull());
    expect(useTabsStore.getState().tabs['tpl']?.state.rowCount).toBe(1);
  });

  it('Clone creates a sibling under the same parent and navigates to it without running', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Clone' }));
    const copy = Object.values(useTabsStore.getState().tabs).find(
      (t) => t.title === 'Copy of Logons',
    );
    expect(copy?.parentUuid).toBe('root');
    expect(copy?.rowDataTrigger).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('loc')).toHaveTextContent(`/view/${copy?.componentUuid}`),
    );
  });

  it('Convert (after confirming) turns the tab into a KustoQueryResult', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Convert' }));
    const buttons = await screen.findAllByRole('button', { name: 'Convert' });
    await user.click(buttons[buttons.length - 1]!);
    const t = useTabsStore.getState().tabs['tpl'];
    expect(t?.componentName).toBe('KustoQueryResult');
    expect(t?.params).toMatchObject({
      cluster: 'https://c.kusto.windows.net',
      database: 'Db',
      query: expect.stringContaining('bob') as string,
    });
  });

  it('Share Link copies a decodable link and shows the snackbar', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Share Link' }));
    expect(
      await screen.findByText('Shared link has been saved to the clipboard.'),
    ).toBeInTheDocument();
    const url = await navigator.clipboard.readText();
    expect(url).toMatch(/#\/share\/t1\?p=[\w-]+&execute=0$/);
    const p = new URL(url.replace('#', '')).searchParams.get('p') ?? '';
    expect(decodeShareParams(p)).toEqual({ user: 'bob' });
  });
});
