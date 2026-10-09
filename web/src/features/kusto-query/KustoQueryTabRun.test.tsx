import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnackbarHost } from '../../components/SnackbarHost';
import { apiUrl, makeRun } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { initAgGrid } from '../grid/agGridSetup';
import { useTabsStore } from '../tabs/tabStore';
import { KustoQueryTab } from './KustoQueryTab';

vi.mock('../../components/CodeEditor', () => ({ CodeEditor: () => <div /> }));

const server = setupMswServer();

beforeEach(() => {
  useTabsStore.reset();
  configureTestApp({ defaultClusters: [] });
  initAgGrid({});
});
afterEach(resetTestApp);

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
