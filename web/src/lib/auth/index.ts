import { createDevStubAuth } from './devStubAuth';
import { getConfig } from '../config/runtimeConfig';
import { createMsalAuthClient } from './msalAuth';
import type { AuthClient } from './types';

export type { AuthAccount, AuthClient } from './types';
export { AuthClientError, toAuthError, type AuthErrorCode } from './errors';
export {
  apiScopes,
  createMsalAuthClient,
  type MsalAuthClient,
  type MsalAuthConfig,
} from './msalAuth';
export { AuthProvider } from './AuthProvider';
export { useAuth, type AuthStatus, type UseAuth } from './useAuth';
export { DEV_ACCOUNT, DEV_TOKEN, createDevStubAuth } from './devStubAuth';

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
  return createMsalAuthClient({ auth, redirectUri, cacheLocation: 'localStorage' });
}

let cached: AuthClient | undefined;

/** The app-wide auth client, created on first use. */
export function getAuthClient(): AuthClient {
  cached ??= createAuthClient();
  return cached;
}

/** Test helper. */
export function resetAuthClientCache(): void {
  cached = undefined;
}
