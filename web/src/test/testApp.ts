import { vi } from 'vitest';
import { resetConfigCache } from '../lib/config/runtimeConfig';
import { TEST_API } from './msw/handlers';

/**
 * Points the real config and API client at the MSW origin (`TEST_API`) with the dev auth stub, so
 * requests go through the real `getApiClient()`. Call in `beforeEach`; pair with `resetTestApp`.
 */
export function configureTestApp(overrides: Record<string, unknown> = {}): void {
  vi.stubEnv('VITE_AUTH_STUB', 'true');
  window.appConfig = {
    auth: { clientId: 'id', authority: 'https://login.example.com/t' },
    redirectUri: 'https://tim.example.com/blank.html',
    tagCluster: 'https://tags.kusto.windows.net',
    apiEndpoint: TEST_API,
    ...overrides,
  };
  resetConfigCache();
}

/** Undoes `configureTestApp`. */
export function resetTestApp(): void {
  vi.unstubAllEnvs();
  delete window.appConfig;
  resetConfigCache();
}
