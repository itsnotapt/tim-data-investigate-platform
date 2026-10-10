import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, vi } from 'vitest';
import { stubBootstrap } from '../test/stubBootstrap';
import { SnackbarHost } from '../components/SnackbarHost';
import { AuthProvider, type AuthClient } from '../lib/auth';
import { useTabsStore } from '../features/tabs';
import { useTemplatesStore } from '../features/templates';
import userEvent from '@testing-library/user-event';
import { resetConfigCache } from '../lib/config/runtimeConfig';
import { AppThemeProvider } from './AppThemeProvider';
import { routes } from './routes';

beforeEach(() => {
  useTabsStore.reset();
  stubBootstrap();
  window.appConfig = {
    auth: { clientId: 'id', authority: 'https://login.example.com/t' },
    redirectUri: 'https://tim.example.com/blank.html',
    tagCluster: 'https://tags.kusto.windows.net',
    wikiUri: 'https://wiki.example',
    issueUri: 'https://issues.example',
    defaultClusters: [],
  };
  resetConfigCache();
});
afterEach(() => {
  delete window.appConfig;
  resetConfigCache();
});

const client: AuthClient = {
  getAccount: vi.fn().mockResolvedValue({ id: 'u', name: 'jo@example.com', tenantId: 't' }),
  acquireToken: vi.fn().mockResolvedValue('tok'),
  login: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
};

function renderAt(entry: string) {
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  render(
    <SnackbarHost>
      <AuthProvider client={client}>
        <RouterProvider router={router} />
      </AuthProvider>
    </SnackbarHost>,
    { wrapper: AppThemeProvider },
  );
  return router;
}

describe('routes', () => {
  it('/ renders Welcome with a working Get Started menu and the side tree', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Welcome to TIM' })).toBeInTheDocument();
    expect(screen.getByText('The triage and investigation experience.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get Started' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reload templates' })).toBeInTheDocument();
  });

  it('Reload templates in the tree notifies when the reload fails', async () => {
    useTemplatesStore.setState({ reload: () => Promise.reject(new Error('offline')) });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Reload templates' }));
    expect(await screen.findByText(/Failed to reload templates: offline/)).toBeInTheDocument();
  });

  it('/share/tpl-1 renders the share page (no such template)', async () => {
    renderAt('/share/tpl-1');
    expect(await screen.findByText('This query was not found.')).toBeInTheDocument();
  });

  it.each([
    ['/queries', 'Query Manager'],
    ['/exportimport', 'Export / Import'],
  ])('%s renders its page', async (path, title) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 2, name: title })).toBeInTheDocument();
  });

  it('/view/:uuid renders the ad-hoc query tab', async () => {
    useTabsStore.getState().createTab({
      componentUuid: 'abc-123',
      componentName: 'KustoQueryResult',
      parentUuid: null,
      title: 'My tab',
      params: { query: 'T', cluster: '', database: '' },
    });
    renderAt('/view/abc-123');
    expect(await screen.findByLabelText('Summary')).toHaveValue('My tab');
  });

  it('/view/:uuid with an unknown uuid redirects to /', async () => {
    const router = renderAt('/view/unknown');
    expect(await screen.findByRole('heading', { name: 'Welcome to TIM' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('redirects an unknown hash to /', async () => {
    const router = renderAt('/no/such/page');
    expect(await screen.findByRole('heading', { name: 'Welcome to TIM' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});
