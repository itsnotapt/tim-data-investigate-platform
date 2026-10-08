import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, vi } from 'vitest';
import { stubBootstrap } from '../test/stubBootstrap';
import { SnackbarHost } from '../components/SnackbarHost';
import { AuthClientError, AuthProvider, type AuthAccount, type AuthClient } from '../lib/auth';
import { getConfig, resetConfigCache } from '../lib/config/runtimeConfig';
import { AppShell } from './AppShell';

beforeEach(() => {
  stubBootstrap();
  window.appConfig = {
    auth: { clientId: 'id', authority: 'https://login.example.com/t' },
    redirectUri: 'https://tim.example.com/blank.html',
    tagCluster: 'https://tags.kusto.windows.net',
    wikiUri: 'https://wiki.example/tim',
    issueUri: 'https://issues.example/new',
    defaultClusters: [],
  };
  resetConfigCache();
});
afterEach(() => {
  delete window.appConfig;
  resetConfigCache();
});

const ACCOUNT: AuthAccount = { id: 'u', name: 'jo@example.com', tenantId: 't' };

function fakeClient(over: Partial<AuthClient> = {}): AuthClient {
  return {
    getAccount: vi.fn().mockResolvedValue(ACCOUNT),
    acquireToken: vi.fn().mockResolvedValue('tok'),
    login: vi.fn().mockResolvedValue(ACCOUNT),
    logout: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function renderShell(client: AuthClient) {
  const router = createMemoryRouter(
    [{ path: '/', element: <AppShell />, children: [{ index: true, element: <p>routes ok</p> }] }],
    { initialEntries: ['/'] },
  );
  return render(
    <SnackbarHost>
      <AuthProvider client={client}>
        <RouterProvider router={router} />
      </AuthProvider>
    </SnackbarHost>,
  );
}

describe('AppShell / AuthGate', () => {
  it('signed out: shows the sign-in prompt and no routes', async () => {
    const login = vi.fn().mockResolvedValue(ACCOUNT);
    renderShell(fakeClient({ getAccount: vi.fn().mockResolvedValue(null), login }));
    expect(await screen.findByText(/You must/)).toHaveTextContent('You must sign-in first.');
    expect(screen.queryByText('routes ok')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'sign-in' }));
    expect(login).toHaveBeenCalled();
    expect(await screen.findByText('routes ok')).toBeInTheDocument();
  });

  it('loading: shows progress', () => {
    renderShell(fakeClient({ getAccount: vi.fn().mockReturnValue(new Promise(() => undefined)) }));
    expect(screen.getByText('Authenticating and loading queries...')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('routes ok')).not.toBeInTheDocument();
  });

  it('error: shows the message and Retry succeeds', async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce(new AuthClientError('interaction_in_progress'))
      .mockResolvedValueOnce(ACCOUNT);
    renderShell(fakeClient({ getAccount: vi.fn().mockResolvedValue(null), login }));
    await userEvent.click(await screen.findByRole('button', { name: 'sign-in' }));
    expect(await screen.findByText(/abnormal state/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('routes ok')).toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('signed in: renders routes and the account name', async () => {
    renderShell(fakeClient());
    expect(await screen.findByText('routes ok')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByText('jo@example.com')).toBeInTheDocument();
  });

  it('logout shows the snackbar', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    renderShell(fakeClient({ logout }));
    await screen.findByText('routes ok');
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByText('You have successfully logged out.')).toBeInTheDocument();
    expect(logout).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('routes ok')).not.toBeInTheDocument());
  });

  it('Help links use config URIs and open in a new tab', async () => {
    renderShell(fakeClient());
    await userEvent.click(screen.getByRole('button', { name: 'Help' }));
    const menu = within(screen.getByRole('menu'));
    const wiki = menu.getByRole('menuitem', { name: /Wiki Page/ });
    const bug = menu.getByRole('menuitem', { name: /Report a bug/ });
    expect(wiki).toHaveAttribute('href', getConfig().wikiUri);
    expect(bug).toHaveAttribute('href', getConfig().issueUri);
    for (const a of [wiki, bug]) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });

  it('menus link to Query Manager, home and Export / Import', async () => {
    renderShell(fakeClient());
    expect(screen.getByRole('link', { name: 'TIM' })).toHaveAttribute('href', '/');
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('menuitem', { name: 'Query Manager' })).toHaveAttribute(
      'href',
      '/queries',
    );
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('menuitem', { name: 'Export / Import' })).toHaveAttribute(
      'href',
      '/exportimport',
    );
  });
});
