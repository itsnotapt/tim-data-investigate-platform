import { defineConfig, devices } from '@playwright/test';

const PORT = 5180;
const CI = !!process.env['CI'];

/**
 * Headless Chromium against the vite dev server with the dev stub auth (VITE_AUTH_STUB=true) and
 * every `/api/**` call intercepted in the tests (e2e/mocks). No Python api needed.
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
  workers: CI ? 2 : undefined,
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
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    stdout: 'ignore',
    env: { VITE_AUTH_STUB: 'true' },
    timeout: 120_000,
  },
});
