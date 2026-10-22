// @vitest-environment node
import type { PlaywrightTestConfig } from '@playwright/test';

async function loadConfig(env: Record<string, string | undefined>): Promise<PlaywrightTestConfig> {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const { default: config } = await import('./playwright.config');
  return config;
}

function webServers(config: PlaywrightTestConfig) {
  const { webServer } = config;
  return webServer === undefined ? [] : [webServer].flat();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('playwright config', () => {
  it('serves the app on E2E_PORT', async () => {
    const config = await loadConfig({ E2E_PORT: '5190' });

    expect(config.use?.baseURL).toBe('http://localhost:5190');
  });

  it('starts vite on E2E_PORT and the api on the next port', async () => {
    const [api, vite] = webServers(await loadConfig({ E2E_PORT: '5190' }));

    expect(api?.command).toMatch(/ 5191$/);
    expect(api?.url).toBe('http://localhost:5191/api/healthChecks/readiness');
    expect(vite?.command).toBe('npx vite --port 5190 --strictPort');
    expect(vite?.url).toBe('http://localhost:5190');
    expect(vite?.env?.['TIM_API_PROXY_TARGET']).toBe('http://localhost:5191');
  });

  it('uses ports 5180 and 5181 without E2E_PORT', async () => {
    const config = await loadConfig({ E2E_PORT: undefined });
    const [api, vite] = webServers(config);

    expect(config.use?.baseURL).toBe('http://localhost:5180');
    expect(vite?.command).toBe('npx vite --port 5180 --strictPort');
    expect(api?.url).toBe('http://localhost:5181/api/healthChecks/readiness');
  });

  it.each(['', 'true'])('never reuses a running server with CI=%j', async (ci) => {
    const config = await loadConfig({ CI: ci });

    expect(webServers(config).map((server) => server.reuseExistingServer)).toEqual([false, false]);
  });

  it.each(['', 'abc', '0', '-1', '5180.5', '1e4', ' 5190', '65535'])(
    'rejects E2E_PORT=%j',
    async (port) => {
      await expect(loadConfig({ E2E_PORT: port })).rejects.toThrow(
        `E2E_PORT must be a whole number from 1 to 65534, got "${port}"`,
      );
    },
  );
});
