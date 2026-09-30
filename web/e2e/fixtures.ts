import { test as base, expect } from '@playwright/test';
import { mockApi, type ApiMock, type ApiMockOptions } from './mocks';

interface Fixtures {
  /** Options for the api mock; override per file with `test.use({ apiOptions: {...} })`. */
  apiOptions: ApiMockOptions;
  /** The mocked api (recorded calls). Installed before the page navigates. */
  api: ApiMock;
}

/**
 * `test` with `/api/**` intercepted and the dev stub auth (VITE_AUTH_STUB, set by the webServer in
 * playwright.config.ts: a fixed signed-in account, no MSAL). Each test gets a fresh browser
 * context, so IndexedDB / localStorage start empty.
 */
export const test = base.extend<Fixtures>({
  apiOptions: [{}, { option: true }],
  api: [
    async ({ page, apiOptions }, use) => {
      const api = await mockApi(page, apiOptions);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await use(api);
      expect(errors, 'uncaught page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
