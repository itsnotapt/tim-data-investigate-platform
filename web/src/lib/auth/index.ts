import { createDevStubAuth } from './devStubAuth';
import type { AuthClient } from './types';

export type { AuthAccount, AuthClient } from './types';
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
  // TODO(P3-01): MSAL popup implementation (ADR-0005).
  throw new Error('MSAL auth is not implemented (P3-01); set VITE_AUTH_STUB=true for dev');
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
