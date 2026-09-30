import {
  BrowserAuthError,
  InteractionRequiredAuthError,
  type AccountInfo,
  type AuthenticationResult,
} from '@azure/msal-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthClientError } from './errors';
import { createMsalAuthClient } from './msalAuth';

const m = vi.hoisted(() => ({
  instance: {} as Record<string, ReturnType<typeof vi.fn>>,
  ctorConfig: undefined as { value: unknown } | undefined,
}));

vi.mock('@azure/msal-browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@azure/msal-browser')>();
  return {
    ...actual,
    PublicClientApplication: vi.fn(function (config: unknown) {
      m.ctorConfig = { value: config };
      return m.instance;
    }),
  };
});

const ACCOUNT = {
  homeAccountId: 'oid.tid',
  localAccountId: 'oid',
  tenantId: 'tid',
  username: 'jo@example.com',
  environment: 'login.microsoftonline.com',
} as AccountInfo;

const result = (token: string, account: AccountInfo | null = ACCOUNT) =>
  ({ accessToken: token, account }) as AuthenticationResult;

const SCOPES = ['api://cid/user_impersonation'];
const interaction = () => new InteractionRequiredAuthError('interaction_required', 'corr-id');

let active: AccountInfo | null;
let cached: AccountInfo[];

beforeEach(() => {
  active = null;
  cached = [ACCOUNT];
  m.instance = {
    initialize: vi.fn().mockResolvedValue(undefined),
    handleRedirectPromise: vi.fn().mockResolvedValue(null),
    getActiveAccount: vi.fn(() => active),
    getAllAccounts: vi.fn(() => cached),
    setActiveAccount: vi.fn((a: AccountInfo | null) => {
      active = a;
    }),
    acquireTokenSilent: vi.fn().mockResolvedValue(result('silent-token')),
    acquireTokenPopup: vi.fn().mockResolvedValue(result('popup-token')),
    ssoSilent: vi.fn().mockRejectedValue(interaction()),
    loginPopup: vi.fn().mockResolvedValue(result('login-token')),
    logoutPopup: vi.fn().mockResolvedValue(undefined),
  };
});

const make = () =>
  createMsalAuthClient({
    auth: { clientId: 'cid', authority: 'https://login.microsoftonline.com/tid' },
    redirectUri: 'https://app.example.com/blank.html',
  });

describe('createMsalAuthClient', () => {
  it('builds MSAL from config, initialises, handles the pending response and restores the account', async () => {
    const client = make();
    expect(m.ctorConfig?.value).toMatchObject({
      auth: {
        clientId: 'cid',
        authority: 'https://login.microsoftonline.com/tid',
        redirectUri: 'https://app.example.com/blank.html',
      },
      cache: { cacheLocation: 'localStorage' },
    });
    expect(await client.getAccount()).toEqual({
      id: 'oid',
      name: 'jo@example.com',
      tenantId: 'tid',
    });
    expect(m.instance.initialize).toHaveBeenCalledTimes(1);
    expect(m.instance.handleRedirectPromise).toHaveBeenCalledTimes(1);
    expect(m.instance.initialize!.mock.invocationCallOrder[0]!).toBeLessThan(
      m.instance.handleRedirectPromise!.mock.invocationCallOrder[0]!,
    );
  });

  it('returns null when there is no cached account', async () => {
    cached = [];
    expect(await make().getAccount()).toBeNull();
  });

  it('returns a silent token without any popup', async () => {
    const client = make();
    expect(await client.acquireToken(SCOPES)).toBe('silent-token');
    expect(m.instance.acquireTokenSilent).toHaveBeenCalledWith({
      scopes: SCOPES,
      account: ACCOUNT,
    });
    expect(m.instance.acquireTokenPopup).not.toHaveBeenCalled();
    expect(m.instance.ssoSilent).not.toHaveBeenCalled();
  });

  it('falls back to a popup on InteractionRequiredAuthError', async () => {
    const client = make();
    m.instance.acquireTokenSilent!.mockRejectedValue(interaction());
    expect(await client.acquireToken(SCOPES)).toBe('popup-token');
    expect(m.instance.acquireTokenPopup).toHaveBeenCalledTimes(1);
  });

  it('does not open a popup for non-interaction errors', async () => {
    const client = make();
    m.instance.acquireTokenSilent!.mockRejectedValue(new Error('network down'));
    await expect(client.acquireToken(SCOPES)).rejects.toBeInstanceOf(AuthClientError);
    expect(m.instance.acquireTokenPopup).not.toHaveBeenCalled();
  });

  it('with no account tries ssoSilent, then the popup', async () => {
    cached = [];
    const client = make();
    expect(await client.acquireToken(SCOPES)).toBe('popup-token');
    expect(m.instance.ssoSilent).toHaveBeenCalledWith({ scopes: SCOPES });
    expect(m.instance.acquireTokenSilent).not.toHaveBeenCalled();
    expect(m.instance.acquireTokenPopup).toHaveBeenCalledTimes(1);
    // The popup result becomes the active account.
    expect(await client.getAccount()).not.toBeNull();
  });

  it('with no account uses the ssoSilent token when it succeeds', async () => {
    cached = [];
    m.instance.ssoSilent!.mockResolvedValue(result('sso-token'));
    expect(await make().acquireToken(SCOPES)).toBe('sso-token');
    expect(m.instance.acquireTokenPopup).not.toHaveBeenCalled();
  });

  // BUG-23
  it('shares one popup between concurrent acquireToken calls', async () => {
    const client = make();
    m.instance.acquireTokenSilent!.mockRejectedValue(interaction());
    let release!: (r: AuthenticationResult) => void;
    m.instance.acquireTokenPopup!.mockReturnValue(
      new Promise<AuthenticationResult>((r) => {
        release = r;
      }),
    );
    const calls = [
      client.acquireToken(SCOPES),
      client.acquireToken(SCOPES),
      client.acquireToken(SCOPES),
    ];
    await vi.waitFor(() => expect(m.instance.acquireTokenPopup).toHaveBeenCalled());
    release(result('shared'));
    expect(await Promise.all(calls)).toEqual(['shared', 'shared', 'shared']);
    expect(m.instance.acquireTokenPopup).toHaveBeenCalledTimes(1);
  });

  it('serialises interactive requests for different scopes', async () => {
    const client = make();
    m.instance.acquireTokenSilent!.mockRejectedValueOnce(interaction());
    let release!: (r: AuthenticationResult) => void;
    m.instance.acquireTokenPopup!.mockReturnValue(
      new Promise<AuthenticationResult>((r) => {
        release = r;
      }),
    );
    const a = client.acquireToken(SCOPES);
    await vi.waitFor(() => expect(m.instance.acquireTokenPopup).toHaveBeenCalled());
    const b = client.acquireToken(['other']);
    release(result('first'));
    expect(await a).toBe('first');
    expect(await b).toBe('silent-token'); // second retried silently after the first settled
    expect(m.instance.acquireTokenPopup).toHaveBeenCalledTimes(1);
  });

  // BUG-22
  it('rejects a failed popup with a typed error and can be retried', async () => {
    const client = make();
    m.instance.acquireTokenSilent!.mockRejectedValue(interaction());
    m.instance.acquireTokenPopup!.mockRejectedValueOnce(
      Object.assign(new Error('closed'), { errorCode: 'user_cancelled' }),
    );
    const err = await client.acquireToken(SCOPES).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthClientError);
    expect((err as AuthClientError).code).toBe('cancelled');
    expect(await client.acquireToken(SCOPES)).toBe('popup-token');
    expect(m.instance.acquireTokenPopup).toHaveBeenCalledTimes(2);
  });

  it('maps popup_window_error to a pop-up blocker hint', async () => {
    const client = make();
    m.instance.loginPopup!.mockRejectedValue(
      Object.assign(new Error('x'), { errorCode: 'popup_window_error' }),
    );
    await expect(client.login()).rejects.toMatchObject({
      code: 'popup_blocked',
      message: expect.stringContaining('pop-up') as string,
    });
  });

  it('maps interaction_in_progress to a friendly message', async () => {
    const client = make();
    m.instance.acquireTokenSilent!.mockRejectedValue(interaction());
    m.instance.acquireTokenPopup!.mockRejectedValue(
      new BrowserAuthError('interaction_in_progress', 'corr-id'),
    );
    const err = (await client.acquireToken(SCOPES).catch((e: unknown) => e)) as AuthClientError;
    expect(err.code).toBe('interaction_in_progress');
    expect(err.message).toMatch(/abnormal state.*clearing the session and cookies/);
  });

  it('login uses loginPopup, activates the account, and shares concurrent calls', async () => {
    cached = [];
    const client = make();
    const [a, b] = await Promise.all([client.login(), client.login()]);
    expect(a).toEqual(b);
    expect(m.instance.loginPopup).toHaveBeenCalledTimes(1);
    expect(m.instance.loginPopup).toHaveBeenCalledWith({
      scopes: SCOPES,
      prompt: 'select_account',
    });
    expect(await client.getAccount()).toEqual(a);
  });

  it('logout uses logoutPopup and clears the active account', async () => {
    const client = make();
    await client.getAccount();
    await client.logout();
    expect(m.instance.logoutPopup).toHaveBeenCalledWith({ account: ACCOUNT });
    expect(await client.getAccount()).toBeNull();
  });

  it('retries initialisation after it failed', async () => {
    const client = make();
    m.instance.initialize!.mockRejectedValueOnce(new Error('boom'));
    await expect(client.getAccount()).rejects.toBeInstanceOf(AuthClientError);
    expect(await client.getAccount()).not.toBeNull();
  });
});
