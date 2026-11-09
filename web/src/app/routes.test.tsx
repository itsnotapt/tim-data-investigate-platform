import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, vi } from 'vitest';
import { stubBootstrap } from '../test/stubBootstrap';
import { SnackbarHost } from '../components/SnackbarHost';
import { AuthProvider, type AuthClient } from '../lib/auth';
import { useTabsStore } from '../features/tabs';
import { tab } from '../test/tabsTestUtils';
import { resetConfigCache } from '../lib/config/runtimeConfig';
import { AppThemeProvider } from './AppThemeProvider';
import { routes } from './routes';

beforeEach(() => {
  useTabsStore.reset();
  stubBootstrap();
  window.appConfig = {
    auth: { clientId: 'id', authority: 'https://login.example.com/t' },
    redirectUri: 'https://tim.example.com/blank.html',
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
  it('/ renders Welcome with a working Get Started menu, the action bar and the side tree', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Welcome to TIM' })).toBeInTheDocument();
    expect(screen.getByText('The triage and investigation experience.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get Started' })).toBeEnabled();
    expect(screen.getByLabelText('Query tree')).toBeInTheDocument();
    const actionBar = within(screen.getByRole('region', { name: 'Action bar' }));
    expect(actionBar.getByRole('button', { name: 'New' })).toBeEnabled();
    expect(actionBar.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('/ says in a tooltip on the disabled Run how to get a query to run', async () => {
    renderAt('/');
    const run = await screen.findByRole('button', { name: 'Run' });
    // A disabled button gets no pointer events; its wrapper holds the tooltip.
    await userEvent.hover(run.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Open a query from the tree, or start a new one, to run it.',
    );
  });

  it('/view/:tabId renders the action tab, with its Run in the action bar', async () => {
    useTabsStore.getState().createTab(tab('abc-123', null, { title: 'My tab' }));
    renderAt('/view/abc-123');
    expect(await screen.findByText('This action is no longer available.')).toBeInTheDocument();
    const actionBar = within(screen.getByRole('region', { name: 'Action bar' }));
    expect(actionBar.getByRole('button', { name: 'New' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Run' })).toHaveLength(1);
    expect(actionBar.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('/view/:tabId with an unknown tabId redirects to /', async () => {
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
