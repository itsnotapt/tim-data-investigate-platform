import type { AuthAccount, AuthClient } from './types';

export const DEV_ACCOUNT: AuthAccount = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'dev.user@example.com',
  tenantId: '00000000-0000-0000-0000-0000000000aa',
};

/** `localStorage` key naming the analyst (upn) the stub signs in as. */
export const DEV_STUB_UPN_KEY = 'tim.devStubUpn';

/** The stub token for `upn`: an api with `TIM_AUTH_DISABLED=true` runs the request as `upn`. */
export const devStubToken = (upn: string): string => `dev:${upn}`;

export const DEV_TOKEN = devStubToken(DEV_ACCOUNT.name);

const accountFor = (upn: string): AuthAccount => ({ ...DEV_ACCOUNT, id: `dev-${upn}`, name: upn });

/** The analyst `DEV_STUB_UPN_KEY` names, else `fallback`. */
function storedAccount(fallback: AuthAccount | null): AuthAccount | null {
  const upn = localStorage.getItem(DEV_STUB_UPN_KEY)?.trim();
  return upn ? accountFor(upn) : fallback;
}

/** A stub client signed in as `storedAccount(fallback)`, read again on `login`; `setAccount` switches analyst. */
function stubClient(fallback: AuthAccount | null) {
  let account = storedAccount(fallback);
  const client = {
    getAccount: () => Promise.resolve(account),
    acquireToken: () =>
      account
        ? Promise.resolve(devStubToken(account.name))
        : Promise.reject(new Error('Not signed in')),
    login: () => {
      account = storedAccount(fallback);
      return Promise.resolve(account);
    },
    logout: () => {
      account = null;
      return Promise.resolve();
    },
  } satisfies AuthClient;
  const setAccount = (next: AuthAccount | null) => {
    account = next;
  };
  return { client, setAccount };
}

/**
 * Dev/Playwright only (`VITE_AUTH_STUB`): signed in as the analyst `DEV_STUB_UPN_KEY` names, else
 * `DEV_ACCOUNT`, with their stub token. Never validated by a real API.
 */
export function createDevStubAuth(): AuthClient {
  return stubClient(DEV_ACCOUNT).client;
}

/**
 * Stub sign-in (ADR-0026): no analyst until one is chosen with `signInAs`, which the browser
 * remembers in `DEV_STUB_UPN_KEY` until logout.
 */
export function createStubSignIn(): AuthClient {
  const { client, setAccount } = stubClient(null);
  return {
    ...client,
    logout: () => {
      localStorage.removeItem(DEV_STUB_UPN_KEY);
      return client.logout();
    },
    signInAs: (name) => {
      const upn = name.trim();
      if (!upn) return Promise.reject(new Error('Enter a name or email'));
      localStorage.setItem(DEV_STUB_UPN_KEY, upn);
      const account = accountFor(upn);
      setAccount(account);
      return Promise.resolve(account);
    },
  };
}
