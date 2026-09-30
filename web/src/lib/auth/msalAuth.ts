import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type AuthenticationResult,
  type IPublicClientApplication,
} from '@azure/msal-browser';
import { toAuthError } from './errors';
import type { AuthAccount, AuthClient } from './types';

export interface MsalAuthConfig {
  auth: { clientId: string; authority: string };
  redirectUri: string;
  /** Legacy default: localStorage (survives reloads, so no prompt on every load; BUG-23). */
  cacheLocation?: 'localStorage' | 'sessionStorage';
}

/** An `AuthClient` backed by MSAL; exposes the instance so `AuthProvider` can wrap `MsalProvider`. */
export interface MsalAuthClient extends AuthClient {
  readonly msal: IPublicClientApplication;
}

/** Same single app registration serves SPA and API (ADR-0005). */
export function apiScopes(clientId: string): string[] {
  return [`api://${clientId}/user_impersonation`];
}

function toAccount(a: AccountInfo): AuthAccount {
  return {
    id: a.localAccountId,
    name: a.username || a.name || a.localAccountId,
    tenantId: a.tenantId,
  };
}

interface InFlight {
  key: string;
  promise: Promise<AuthenticationResult>;
}

export function createMsalAuthClient(config: MsalAuthConfig): MsalAuthClient {
  const msal = new PublicClientApplication({
    auth: {
      clientId: config.auth.clientId,
      authority: config.auth.authority,
      redirectUri: config.redirectUri,
    },
    cache: { cacheLocation: config.cacheLocation ?? 'localStorage' },
  });
  const loginScopes = apiScopes(config.auth.clientId);

  // Initialise, clear any pending response, and restore the cached account (BUG-23).
  let ready: Promise<void> | undefined;
  const ensureReady = (): Promise<void> => {
    ready ??= (async () => {
      await msal.initialize();
      const pending = await msal.handleRedirectPromise();
      const account = pending?.account ?? msal.getActiveAccount() ?? msal.getAllAccounts()[0];
      if (account) msal.setActiveAccount(account);
    })().catch((e: unknown) => {
      ready = undefined; // allow a retry after a failed init
      throw toAuthError(e);
    });
    return ready;
  };

  // At most one interactive request at a time (BUG-23). Cleared on settle so a failure or a
  // cancelled popup can be retried (BUG-22).
  let inFlight: InFlight | undefined;
  const interactive = (
    key: string,
    run: () => Promise<AuthenticationResult>,
  ): Promise<AuthenticationResult> => {
    if (inFlight?.key === key) return inFlight.promise;
    const promise = (async () => {
      await Promise.resolve(); // never settle synchronously, before `inFlight` is set below
      try {
        const result = await run();
        if (result.account) msal.setActiveAccount(result.account);
        return result;
      } catch (e) {
        throw toAuthError(e);
      } finally {
        if (inFlight?.key === key) inFlight = undefined;
      }
    })();
    inFlight = { key, promise };
    return promise;
  };

  /** Waits for a different in-flight interactive request; returns true if there was one. */
  const waitForOther = async (key: string): Promise<boolean> => {
    if (!inFlight || inFlight.key === key) return false;
    await inFlight.promise.catch(() => undefined);
    return true;
  };

  const popup = (scopes: string[], account?: AccountInfo) =>
    interactive(`token:${[...scopes].sort().join(' ')}`, () =>
      msal.acquireTokenPopup({ scopes, ...(account ? { account } : {}) }),
    );

  const acquireToken = async (scopes: string[]): Promise<string> => {
    await ensureReady();
    if (await waitForOther(`token:${[...scopes].sort().join(' ')}`)) return acquireToken(scopes);

    const account = msal.getActiveAccount();
    if (!account) {
      // Not signed in: try a silent SSO before bothering the user.
      try {
        const result = await msal.ssoSilent({ scopes });
        msal.setActiveAccount(result.account);
        return result.accessToken;
      } catch {
        return (await popup(scopes)).accessToken;
      }
    }
    try {
      return (await msal.acquireTokenSilent({ scopes, account })).accessToken;
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError)
        return (await popup(scopes, account)).accessToken;
      throw toAuthError(e);
    }
  };

  return {
    msal,
    async getAccount() {
      await ensureReady();
      const a = msal.getActiveAccount();
      return a ? toAccount(a) : null;
    },
    acquireToken,
    async login() {
      await ensureReady();
      if (await waitForOther('login')) {
        const existing = msal.getActiveAccount();
        if (existing) return toAccount(existing);
      }
      const result = await interactive('login', () =>
        msal.loginPopup({ scopes: loginScopes, prompt: 'select_account' }),
      );
      return toAccount(result.account);
    },
    async logout() {
      await ensureReady();
      const account = msal.getActiveAccount();
      try {
        await msal.logoutPopup(account ? { account } : {});
      } catch (e) {
        throw toAuthError(e);
      }
      msal.setActiveAccount(null);
    },
  };
}
