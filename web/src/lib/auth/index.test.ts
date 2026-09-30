import { describe, expect, it } from 'vitest';
import { DEV_ACCOUNT, DEV_TOKEN, createAuthClient } from './index';

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

  it.each([undefined, '', 'false', 'TRUE'])('does not use the stub for %j', (value) => {
    expect(() => createAuthClient({ VITE_AUTH_STUB: value, MODE: 'development' })).toThrow(/P3-01/);
  });

  it('stub logout clears the account and token; login restores it', async () => {
    const client = createAuthClient({ VITE_AUTH_STUB: 'true', MODE: 'development' });
    await client.logout();
    expect(await client.getAccount()).toBeNull();
    await expect(client.acquireToken([])).rejects.toThrow('Not signed in');
    expect(await client.login()).toEqual(DEV_ACCOUNT);
    expect(await client.getAccount()).toEqual(DEV_ACCOUNT);
  });
});
