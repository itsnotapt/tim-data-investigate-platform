import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach } from 'vitest';
import { SnackbarHost } from '../components/SnackbarHost';
import { AuthProvider, createAuthClient } from '../lib/auth';
import { resetConfigCache } from '../lib/config/runtimeConfig';
import { stubBootstrap } from '../test/stubBootstrap';
import { AppShell } from './AppShell';
import { AppThemeProvider } from './AppThemeProvider';

beforeEach(() => {
  stubBootstrap();
  window.appConfig = { stubSignIn: true };
  resetConfigCache();
});
afterEach(() => {
  delete window.appConfig;
  resetConfigCache();
});

/** The shell with stub sign-in from the runtime config; each call is a fresh page load. */
function loadPage() {
  const router = createMemoryRouter(
    [{ path: '/', element: <AppShell />, children: [{ index: true, element: <p>routes ok</p> }] }],
    { initialEntries: ['/'] },
  );
  return render(
    <SnackbarHost>
      <AuthProvider client={createAuthClient({ MODE: 'production' })}>
        <RouterProvider router={router} />
      </AuthProvider>
    </SnackbarHost>,
    { wrapper: AppThemeProvider },
  );
}

async function expectSignedInAs(name: string) {
  expect(await screen.findByText('routes ok')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Who are you?' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Account' }));
  expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
}

describe('Who are you?', () => {
  it('is shown, with no routes, until an analyst is chosen', async () => {
    loadPage();
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(screen.queryByText('routes ok')).not.toBeInTheDocument();
  });

  it('typing a name signs in as it', async () => {
    loadPage();
    await userEvent.type(await screen.findByLabelText('Name or email'), 'carol@example.com{Enter}');
    await expectSignedInAs('carol@example.com');
  });

  it('Sign in is disabled until a name is typed', async () => {
    loadPage();
    const signIn = await screen.findByRole('button', { name: 'Sign in' });
    expect(signIn).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Name or email'), '   ');
    expect(signIn).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Name or email'), 'dana');
    await userEvent.click(signIn);
    await expectSignedInAs('dana');
  });

  it.each(['alice@demo.example', 'bob@demo.example'])(
    'the demo analyst button signs in as %s',
    async (name) => {
      loadPage();
      await userEvent.click(await screen.findByRole('button', { name }));
      await expectSignedInAs(name);
    },
  );

  it('the choice survives a reload', async () => {
    const page = loadPage();
    await userEvent.click(await screen.findByRole('button', { name: 'bob@demo.example' }));
    expect(await screen.findByText('routes ok')).toBeInTheDocument();
    page.unmount();
    loadPage();
    await expectSignedInAs('bob@demo.example');
  });

  it('Sign out returns to the screen, also after a reload', async () => {
    const page = loadPage();
    await userEvent.click(await screen.findByRole('button', { name: 'alice@demo.example' }));
    expect(await screen.findByText('routes ok')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(screen.queryByText('routes ok')).not.toBeInTheDocument();
    page.unmount();
    loadPage();
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
  });

  it('Sign in in the Account menu stays on the screen while no analyst is chosen', async () => {
    loadPage();
    await screen.findByRole('heading', { name: 'Who are you?' });
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
