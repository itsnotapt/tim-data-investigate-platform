import { createDevStubAuth } from './devStubAuth';
import { getConfig } from '../config/runtimeConfig';
import { createMsalAuthClient } from './msalAuth';
import type { AuthClient } from './types';

export type { AuthAccount, AuthClient } from './types';
export { AuthClientError } from './errors';
export { apiScopes } from './msalAuth';
export { AuthProvider } from './AuthProvider';
export { useAuth } from './useAuth';
export { DEV_ACCOUNT, DEV_TOKEN } from './devStubAuth';

export interface AuthEnv {
  VITE_AUTH_STUB?: unknown;
  MODE?: string;
}

/**
 * Picks the auth implementation. The stub is used when `VITE_AUTH_STUB === 'true'`, and
 * requesting it in a production build throws.
 */
export function createAuthClient(env: AuthEnv = import.meta.env): AuthClient {
  if (env.VITE_AUTH_STUB === 'true') {
    if (env.MODE === 'production') {
      throw new Error('VITE_AUTH_STUB=true is not allowed in a production build');
    }
    return createDevStubAuth();
  }
  const { auth, redirectUri } = getConfig();
  return createMsalAuthClient({ auth, redirectUri });
}

let cached: AuthClient | undefined;

/** The app-wide auth client, created on first use. */
export function getAuthClient(): AuthClient {
  cached ??= createAuthClient();
  return cached;
}
