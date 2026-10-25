import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, vi } from 'vitest';
import { stubBootstrap } from '../test/stubBootstrap';
import { SnackbarHost } from '../components/SnackbarHost';
import { AuthProvider, type AuthClient } from '../lib/auth';
import { useTabsStore } from '../features/tabs';
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
    expect(screen.getByRole('button', { name: 'New query' })).toBeInTheDocument();
  });

  it('/view/:uuid renders the action tab', async () => {
    useTabsStore.getState().createTab({
      componentUuid: 'abc-123',
      componentName: 'ActionResult',
      parentUuid: null,
      title: 'My tab',
      params: { action: 'acme.sign_ins', params: {} },
    });
    renderAt('/view/abc-123');
    expect(await screen.findByText('This action is no longer available.')).toBeInTheDocument();
  });

  it('/view/:uuid with an unknown uuid redirects to /', async () => {
    const router = renderAt('/view/unknown');
    expect(await screen.findByRole('heading', { name: 'Welcome to TIM' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it.each(['/no/such/page', '/queries', '/share/tpl-1?p=e30&execute=1', '/exportimport'])(
    'redirects an unknown hash, such as %s, to /',
    async (path) => {
      const router = renderAt(path);
      expect(await screen.findByRole('heading', { name: 'Welcome to TIM' })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/');
    },
  );
});
