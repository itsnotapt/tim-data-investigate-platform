import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AuthClientError } from './errors';
import { AuthProvider } from './AuthProvider';
import type { AuthAccount, AuthClient } from './types';
import { useAuth } from './useAuth';

const ACCOUNT: AuthAccount = { id: 'oid', name: 'jo@example.com', tenantId: 'tid' };

function fakeClient(over: Partial<AuthClient> = {}): AuthClient {
  return {
    getAccount: vi.fn().mockResolvedValue(null),
    acquireToken: vi.fn().mockResolvedValue('tok'),
    login: vi.fn().mockResolvedValue(ACCOUNT),
    logout: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

let latest: ReturnType<typeof useAuth>;
function Probe() {
  const auth = useAuth();
  useEffect(() => {
    latest = auth;
  });
  return (
    <div data-testid="s">{`${auth.status}:${auth.account?.name ?? '-'}:${auth.error?.message ?? '-'}`}</div>
  );
}
const renderWith = (client: AuthClient) =>
  render(
    <AuthProvider client={client} scopes={['s1']}>
      <Probe />
    </AuthProvider>,
  );
const state = () => screen.getByTestId('s').textContent;

describe('useAuth', () => {
  it('throws outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/AuthProvider/);
  });

  it('goes loading -> signedOut when there is no account', async () => {
    renderWith(fakeClient());
    expect(state()).toBe('loading:-:-');
    await waitFor(() => expect(state()).toBe('signedOut:-:-'));
  });

  it('goes loading -> signedIn when an account is cached', async () => {
    renderWith(fakeClient({ getAccount: vi.fn().mockResolvedValue(ACCOUNT) }));
    await waitFor(() => expect(state()).toBe('signedIn:jo@example.com:-'));
  });

  it('goes to error when initialisation fails', async () => {
    renderWith(fakeClient({ getAccount: vi.fn().mockRejectedValue(new Error('init failed')) }));
    await waitFor(() => expect(state()).toContain('error:-:Sign-in failed: init failed'));
  });

  it('login: signedOut -> loading -> signedIn, then logout -> signedOut', async () => {
    let finish!: (a: AuthAccount) => void;
    const client = fakeClient({
      login: vi.fn().mockReturnValue(new Promise<AuthAccount>((r) => (finish = r))),
    });
    renderWith(client);
    await waitFor(() => expect(state()).toBe('signedOut:-:-'));
    let p!: Promise<void>;
    act(() => {
      p = latest.login();
    });
    expect(state()).toBe('loading:-:-');
    await act(async () => {
      finish(ACCOUNT);
      await p;
    });
    expect(state()).toBe('signedIn:jo@example.com:-');
    await act(() => latest.logout());
    expect(state()).toBe('signedOut:-:-');
  });

  it('a failed login shows an error and can be retried', async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce(new AuthClientError('interaction_in_progress'))
      .mockResolvedValueOnce(ACCOUNT);
    renderWith(fakeClient({ login }));
    await waitFor(() => expect(state()).toBe('signedOut:-:-'));
    await act(() => latest.login());
    expect(state()).toContain('error:-:Authentication is in an abnormal state');
    expect(latest.error).toBeInstanceOf(AuthClientError);
    await act(() => latest.login());
    expect(state()).toBe('signedIn:jo@example.com:-');
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('getToken defaults to the provider scopes', async () => {
    const acquire = vi.fn().mockResolvedValue('tok');
    renderWith(fakeClient({ acquireToken: acquire }));
    await expect(latest.getToken()).resolves.toBe('tok');
    expect(acquire).toHaveBeenCalledWith(['s1']);
    await latest.getToken(['other']);
    expect(acquire).toHaveBeenLastCalledWith(['other']);
  });
});
