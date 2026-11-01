import { createDevStubAuth, createStubSignIn } from './devStubAuth';
import { getConfig } from '../config/runtimeConfig';
import { apiScopes, createMsalAuthClient } from './msalAuth';
import type { AuthClient } from './types';

export type { AuthAccount, AuthClient } from './types';
export { AuthClientError } from './errors';
export { apiScopes } from './msalAuth';
export { AuthProvider } from './AuthProvider';
export { useAuth } from './useAuth';
export { DEV_ACCOUNT, DEV_STUB_UPN_KEY, DEV_TOKEN } from './devStubAuth';

export interface AuthEnv {
  VITE_AUTH_STUB?: unknown;
  MODE?: string;
}

/**
 * Picks the auth implementation:
 * - `VITE_AUTH_STUB === 'true'`: the dev stub, signed in as `DEV_ACCOUNT` or the stored analyst.
 *   Requesting it in a production build throws.
 * - `stubSignIn` in the runtime config: stub sign-in, with no analyst until one is chosen. The web
 *   container renders it only in development (ADR-0026).
 * - Otherwise MSAL.
 */
export function createAuthClient(env: AuthEnv = import.meta.env): AuthClient {
  if (env.VITE_AUTH_STUB === 'true') {
    if (env.MODE === 'production') {
      throw new Error('VITE_AUTH_STUB=true is not allowed in a production build');
    }
    return createDevStubAuth();
  }
  const config = getConfig();
  if (config.stubSignIn) return createStubSignIn();
  return createMsalAuthClient({ auth: config.auth, redirectUri: config.redirectUri });
}

let cached: AuthClient | undefined;

/** The app-wide auth client, created on first use. */
export function getAuthClient(): AuthClient {
  cached ??= createAuthClient();
  return cached;
}

/** A token for the api from the app-wide auth client, for the api scope under Entra. */
export function getApiToken(): Promise<string> {
  const config = getConfig();
  return getAuthClient().acquireToken(config.stubSignIn ? [] : apiScopes(config.auth.clientId));
}
