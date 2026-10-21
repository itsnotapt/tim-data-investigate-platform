import {
  test as base,
  expect,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { DEV_STUB_UPN_KEY, devStubToken } from '../src/lib/auth/devStubAuth';

/** An analyst signed in with the dev stub auth in a browser context of their own. */
export interface Analyst {
  upn: string;
  context: BrowserContext;
  page: Page;
  /** Calls the real api as this analyst, with their stub token. */
  get: (path: string) => Promise<APIResponse>;
}

interface Fixtures {
  /**
   * Random per-test prefix for the `id`s a test gives its rows, so tests sharing the database
   * never see each other's annotations.
   */
  idPrefix: string;
  /** The analyst `page` is signed in as: `<idPrefix>.analyst@example.com`. */
  analyst: Analyst;
  /** Signs another analyst in, in a new browser context: a second analyst. */
  signIn: (upn: string) => Promise<Analyst>;
}

async function signInAs(context: BrowserContext, upn: string): Promise<Analyst> {
  await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    DEV_STUB_UPN_KEY,
    upn,
  ] as const);
  const headers = { Authorization: `Bearer ${devStubToken(upn)}` };
  return {
    upn,
    context,
    page: await context.newPage(),
    get: (path) => context.request.get(path, { headers }),
  };
}

/**
 * `test` against the real tim-api that playwright.config.ts starts, with the dev stub auth.
 * Nothing is intercepted: `page.route` is only for faults the server can't produce.
 */
export const test = base.extend<Fixtures>({
  // Playwright reads each fixture's dependencies from its first parameter, which must be an
  // object pattern even when empty.
  // eslint-disable-next-line no-empty-pattern
  idPrefix: async ({}, provide) => {
    await provide(`e2e-${crypto.randomUUID().slice(0, 8)}`);
  },
  analyst: async ({ context, idPrefix }, provide) => {
    // Signed in before `page` opens, so the app starts as this analyst.
    await provide(await signInAs(context, `${idPrefix}.analyst@example.com`));
  },
  page: async ({ analyst }, provide) => {
    await provide(analyst.page);
  },
  signIn: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async (upn) => {
      const context = await browser.newContext();
      contexts.push(context);
      return signInAs(context, upn);
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect };
