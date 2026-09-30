import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { SnackbarHost } from '../components/SnackbarHost';
import { AuthProvider, type AuthClient } from '../lib/auth';
import { routes } from './routes';

vi.mock('../lib/config/runtimeConfig', () => ({
  getConfig: vi.fn(() => ({ wikiUri: 'https://wiki.example', issueUri: 'https://issues.example' })),
}));

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
  );
  return router;
}

describe('routes', () => {
  it('/ renders Welcome with a Get Started placeholder', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Welcome to TIM' })).toBeInTheDocument();
    expect(screen.getByText('The triage and investigation experience.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get Started' })).toBeDisabled();
  });

  it.each([
    ['/queries', 'Query Manager'],
    ['/view/abc-123', 'View'],
    ['/share/tpl-1', 'Share query'],
    ['/exportimport', 'Export / Import'],
  ])('%s renders its page', async (path, title) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 2, name: title })).toBeInTheDocument();
  });

  it('passes :uuid params to view and share pages', async () => {
    renderAt('/view/abc-123');
    expect(await screen.findByText('Display component: abc-123')).toBeInTheDocument();
  });

  it('redirects an unknown hash to /', async () => {
    const router = renderAt('/no/such/page');
    expect(await screen.findByRole('heading', { name: 'Welcome to TIM' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});
