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
      const gridMessages: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // A missing AG Grid module logs console error #200; other AG Grid warnings are also bugs.
      // The trial-licence banner (no licence key in e2e) is expected and ignored.
      page.on('console', (m) => {
        const text = m.text();
        if (m.type() !== 'error' && m.type() !== 'warning') return;
        if (!/AG Grid/i.test(text) || /Enterprise License|unlocked for trial/i.test(text)) return;
        gridMessages.push(`${m.type()}: ${text}`);
      });
      await use(api);
      expect(errors, 'uncaught page errors').toEqual([]);
      expect(gridMessages, 'AG Grid console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
