import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = parseE2ePort(process.env['E2E_PORT']);
const API_PORT = PORT + 1;
const CI = !!process.env['CI'];

/** Vite's port: E2E_PORT, else 5180. The api takes the next port, so 65534 is the highest. */
function parseE2ePort(value: string | undefined): number {
  if (value === undefined) return 5180;
  const error = new Error(`E2E_PORT must be a whole number from 1 to 65534, got "${value}"`);
  if (!/^\d+$/.test(value)) throw error;
  const port = Number(value);
  if (port < 1 || port > 65534) throw error;
  return port;
}

/**
 * Headless Chromium against the vite dev server with the dev stub auth (VITE_AUTH_STUB=true), and
 * a real tim-api (e2e/api_server.py) that vite proxies `/api` to: auth disabled, so it takes each
 * analyst from the stub token, with the development actions and the action files in e2e/actions.
 * Its Postgres (TIM_TEST_DATABASE_URL, else a temporary pgserver) is reset once per run.
 *
 * Flows that import e2e/realApi.ts use the real api. Those that import e2e/fixtures.ts intercept
 * every `/api/**` call (e2e/mocks) instead.
 *
 * Dev server rather than `vite preview`: the stub is refused in production builds, and dev needs
 * no build step. `/config.js` comes from public/config.js.
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 3 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: `uv run --project ../api python e2e/api_server.py ${API_PORT}`,
      url: `http://localhost:${API_PORT}/api/healthChecks/readiness`,
      // Never reused: each run starts from an empty database.
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      env: {
        TIM_ENVIRONMENT: 'development',
        TIM_LOG_LEVEL: 'WARNING',
        TIM_AUTH_DISABLED: 'true',
        TIM_DEV_ACTIONS: 'true',
        TIM_ACTIONS_DIR: resolve(import.meta.dirname, 'e2e/actions'),
        TIM_CONNECTIONS_FILE: resolve(import.meta.dirname, 'e2e/connections.yaml'),
        TIM_AUTH_TENANT_ID: '00000000-0000-0000-0000-000000000000',
        TIM_AUTH_CLIENT_ID: '00000000-0000-0000-0000-000000000000',
        TIM_TAG_CLUSTER_URI: 'https://example.westeurope.kusto.windows.net',
      },
      timeout: 180_000,
    },
    {
      command: `npx vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      // Never reused, locally or in CI.
      reuseExistingServer: false,
      stdout: 'ignore',
      env: { VITE_AUTH_STUB: 'true', TIM_API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      timeout: 120_000,
    },
  ],
});
