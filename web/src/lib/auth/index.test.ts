import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '../config/runtimeConfig';
import { DEV_ACCOUNT, DEV_STUB_UPN_KEY, DEV_TOKEN, createAuthClient } from './index';

beforeEach(() => {
  window.appConfig = {
    auth: { clientId: 'cid', authority: 'https://login.microsoftonline.com/tid' },
    redirectUri: 'https://app.example.com/blank.html',
  };
  resetConfigCache();
});
afterEach(() => {
  delete window.appConfig;
  resetConfigCache();
  localStorage.clear();
});

describe('createAuthClient', () => {
  it('returns the stub when VITE_AUTH_STUB is true in development', async () => {
    const client = createAuthClient({ VITE_AUTH_STUB: 'true', MODE: 'development' });
    expect(await client.getAccount()).toEqual(DEV_ACCOUNT);
    expect(await client.acquireToken(['api://x/user_impersonation'])).toBe(DEV_TOKEN);
  });

  it('allows the stub in other non-production modes such as test', () => {
    expect(() => createAuthClient({ VITE_AUTH_STUB: 'true', MODE: 'test' })).not.toThrow();
  });

  it('throws when the stub is requested in a production build', () => {
    expect(() => createAuthClient({ VITE_AUTH_STUB: 'true', MODE: 'production' })).toThrow(
      /not allowed in a production build/,
    );
  });

  it.each([undefined, '', 'false', 'TRUE'])('uses MSAL, not the stub, for %j', (value) => {
    const client = createAuthClient({ VITE_AUTH_STUB: value, MODE: 'development' });
    expect(client).toHaveProperty('msal');
  });

  it('stub logout clears the account and token; login restores it', async () => {
    const client = createAuthClient({ VITE_AUTH_STUB: 'true', MODE: 'development' });
    await client.logout();
    expect(await client.getAccount()).toBeNull();
    await expect(client.acquireToken([])).rejects.toThrow('Not signed in');
    expect(await client.login()).toEqual(DEV_ACCOUNT);
    expect(await client.getAccount()).toEqual(DEV_ACCOUNT);
  });

  it('the VITE_AUTH_STUB stub has no "Who are you?", and keeps the stored analyst on logout', async () => {
    localStorage.setItem(DEV_STUB_UPN_KEY, 'carol@example.com');
    const client = createAuthClient({ VITE_AUTH_STUB: 'true', MODE: 'development' });
    expect(client).not.toHaveProperty('signInAs');
    await client.logout();
    expect(await client.login()).toMatchObject({ name: 'carol@example.com' });
  });

  it('stub signs in as the analyst named in localStorage, with their stub token', async () => {
    localStorage.setItem(DEV_STUB_UPN_KEY, 'bob@example.com');
    const client = createAuthClient({ VITE_AUTH_STUB: 'true', MODE: 'development' });
    expect(await client.getAccount()).toMatchObject({ name: 'bob@example.com' });
    expect(await client.acquireToken([])).toBe('dev:bob@example.com');
    expect(DEV_TOKEN).toBe('dev:dev.user@example.com');
  });
});

describe('createAuthClient with stubSignIn in the runtime config', () => {
  const stubConfig = () => {
    window.appConfig = { stubSignIn: true };
    resetConfigCache();
  };

  it('returns the stub, with no analyst until one is chosen, even in a production build', async () => {
    stubConfig();
    const client = createAuthClient({ MODE: 'production' });
    expect(client).not.toHaveProperty('msal');
    expect(await client.getAccount()).toBeNull();
    expect(await client.login()).toBeNull();
    await expect(client.acquireToken([])).rejects.toThrow('Not signed in');
  });

  it('signs in as the chosen analyst, and a new client remembers them', async () => {
    stubConfig();
    const client = createAuthClient({ MODE: 'production' });
    expect(await client.signInAs?.('  alice@demo.example ')).toMatchObject({
      name: 'alice@demo.example',
    });
    expect(await client.acquireToken([])).toBe('dev:alice@demo.example');
    const reloaded = createAuthClient({ MODE: 'production' });
    expect(await reloaded.getAccount()).toMatchObject({ name: 'alice@demo.example' });
  });

  it('logout forgets the analyst', async () => {
    stubConfig();
    const client = createAuthClient({ MODE: 'production' });
    await client.signInAs?.('bob@demo.example');
    await client.logout();
    expect(await client.getAccount()).toBeNull();
    expect(await createAuthClient({ MODE: 'production' }).getAccount()).toBeNull();
  });

  it('refuses a blank name', async () => {
    stubConfig();
    const client = createAuthClient({ MODE: 'production' });
    await expect(client.signInAs?.('   ')).rejects.toThrow('Enter a name or email');
    expect(await client.getAccount()).toBeNull();
  });
});
