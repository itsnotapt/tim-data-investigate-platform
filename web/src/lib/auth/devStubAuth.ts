import type { AuthAccount, AuthClient } from './types';

export const DEV_ACCOUNT: AuthAccount = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'dev.user@example.com',
  tenantId: '00000000-0000-0000-0000-0000000000aa',
};

/** `localStorage` key naming the analyst (upn) the stub signs in as; unset means `DEV_ACCOUNT`. */
export const DEV_STUB_UPN_KEY = 'tim.devStubUpn';

/** The stub token for `upn`: an api with `TIM_AUTH_DISABLED=true` runs the request as `upn`. */
export const devStubToken = (upn: string): string => `dev:${upn}`;

export const DEV_TOKEN = devStubToken(DEV_ACCOUNT.name);

function chosenAccount(): AuthAccount {
  const upn = localStorage.getItem(DEV_STUB_UPN_KEY)?.trim();
  return upn ? { ...DEV_ACCOUNT, id: `dev-${upn}`, name: upn } : DEV_ACCOUNT;
}

/**
 * Dev/Playwright only: a signed-in account, `DEV_ACCOUNT` or the analyst `DEV_STUB_UPN_KEY` names,
 * and its stub token. Never validated by a real API.
 */
export function createDevStubAuth(): AuthClient {
  let account: AuthAccount | null = chosenAccount();
  return {
    getAccount: () => Promise.resolve(account),
    acquireToken: () =>
      account
        ? Promise.resolve(devStubToken(account.name))
        : Promise.reject(new Error('Not signed in')),
    login: () => {
      account = chosenAccount();
      return Promise.resolve(account);
    },
    logout: () => {
      account = null;
      return Promise.resolve();
    },
  };
}
