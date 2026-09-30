import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SnackbarHost } from '../../components/SnackbarHost';
import { resetConfigCache } from '../../lib/config/runtimeConfig';
import { apiUrl, makeRun, TEST_API } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { initAgGrid } from '../grid';
import { useTabsStore } from '../tabs/tabStore';
import { KustoQueryTab } from './KustoQueryTab';

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

beforeEach(() => {
  useTabsStore.reset();
  window.appConfig = {
    auth: { clientId: 'id', authority: 'https://login.example.com/t' },
    redirectUri: 'https://tim.example.com/blank.html',
    tagCluster: 'https://tags.kusto.windows.net',
    defaultClusters: [],
  };
  resetConfigCache();
  initAgGrid({});
});

describe('KustoQueryTab run', () => {
  it('Run Query shows the snackbar, runs the query and shows the grid with stats', async () => {
    server.use(
      http.post(apiUrl('/api/kusto/query'), () =>
        HttpResponse.json(
          makeRun({
            status: 'completed',
            resultData: [{ Name: 'alpha' }],
            executionMetrics: { execution_time: 1.5 },
          }),
        ),
      ),
    );
    const uuid = useTabsStore.getState().createTab({
      componentName: 'KustoQueryResult',
      parentUuid: null,
      title: 'Q',
      params: { query: 'T', cluster: 'https://c', database: 'd' },
    });
    render(
      <SnackbarHost>
        <MemoryRouter>
          <KustoQueryTab uuid={uuid} />
        </MemoryRouter>
      </SnackbarHost>,
    );
    const user = userEvent.setup();
    expect(screen.queryByTestId('results-grid')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Save Changes & Run/ }));
    expect(await screen.findByText('Executing query...')).toBeInTheDocument();
    expect(await screen.findByTestId('results-grid')).toBeInTheDocument();
    expect(await screen.findByText('alpha')).toBeInTheDocument();
    expect(await screen.findByText('1.5')).toBeInTheDocument();
  });
});
