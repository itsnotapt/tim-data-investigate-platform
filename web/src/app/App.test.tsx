import { render, screen } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';
import { stubBootstrap } from '../test/stubBootstrap';
import { App } from './App';
import { AppThemeProvider } from './AppThemeProvider';
import type { AuthClient } from '../lib/auth';
import { resetConfigCache } from '../lib/config/runtimeConfig';

beforeEach(stubBootstrap);

const client = (): AuthClient => ({
  getAccount: vi.fn().mockResolvedValue({ id: 'u', name: 'jo@example.com', tenantId: 't' }),
  acquireToken: vi.fn().mockResolvedValue('tok'),
  login: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
});

describe('App', () => {
  beforeEach(() => {
    window.appConfig = {
      auth: { clientId: 'cid', authority: 'https://login.example/tenant' },
      redirectUri: 'http://localhost/blank.html',
      apiEndpoint: '/api',
      tagCluster: 'https://tag.example',
    };
    resetConfigCache();
  });
  afterEach(() => {
    delete window.appConfig;
    resetConfigCache();
  });

  it('renders the app bar title and the home route once signed in', async () => {
    window.location.hash = '#/';
    render(<App authClient={client()} />, { wrapper: AppThemeProvider });
    expect(screen.getByRole('heading', { level: 1, name: 'TIM' })).toBeInTheDocument();
    expect(await screen.findByText('Welcome to TIM')).toBeInTheDocument();
  });

  it('renders a placeholder route from the hash', async () => {
    window.location.hash = '#/queries';
    render(<App authClient={client()} />, { wrapper: AppThemeProvider });
    expect(await screen.findByText('Query Manager', { selector: 'h2' })).toBeInTheDocument();
  });
});
