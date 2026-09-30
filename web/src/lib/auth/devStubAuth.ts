import type { AuthAccount, AuthClient } from './types';

export const DEV_ACCOUNT: AuthAccount = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'dev.user@example.com',
  tenantId: '00000000-0000-0000-0000-0000000000aa',
};

export const DEV_TOKEN = 'dev-stub-token';

/** Dev/Playwright only: a fixed signed-in account and a fake token. Never validated by a real API. */
export function createDevStubAuth(): AuthClient {
  let account: AuthAccount | null = DEV_ACCOUNT;
  return {
    getAccount: () => Promise.resolve(account),
    acquireToken: () =>
      account ? Promise.resolve(DEV_TOKEN) : Promise.reject(new Error('Not signed in')),
    login: () => {
      account = DEV_ACCOUNT;
      return Promise.resolve(account);
    },
    logout: () => {
      account = null;
      return Promise.resolve();
    },
  };
}
