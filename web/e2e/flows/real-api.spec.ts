import type { Page } from '@playwright/test';
import type { components } from '../../src/lib/api/schema';
import { test, expect } from '../realApi';

type Instance = components['schemas']['Instance'];
type Run = components['schemas']['Run'];

/** Opens the app and returns the Authorization header of its first api call, once the real api
 * has answered it. */
async function openApp(page: Page): Promise<string | undefined> {
  const bootstrap = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith('/api/'));
  await page.goto('/');
  const response = await bootstrap;
  expect(response.ok()).toBe(true);
  return response.request().headers()['authorization'];
}

test(
  'a stub analyst signs in and the real api lists the dev actions',
  { tag: '@smoke' },
  async ({ page, analyst }) => {
    expect(await openApp(page)).toBe(`Bearer dev:${analyst.upn}`);
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(page.getByRole('menuitem', { name: analyst.upn })).toBeVisible();

    const instance = await analyst.get('/api/instance');
    expect(instance.ok()).toBe(true);
    const { actions } = (await instance.json()) as Instance;
    expect(actions.map((action) => action.key)).toEqual(
      expect.arrayContaining([
        'tim.dev_json',
        'dev-sign-ins',
        'dev-generated',
        'dev-slow',
        'dev-failing',
      ]),
    );
  },
);

test(
  'two browser contexts are two analysts',
  { tag: '@smoke' },
  async ({ analyst, signIn, idPrefix }) => {
    const second = await signIn(`${idPrefix}.second@example.com`);
    const owners: string[] = [];
    for (const each of [analyst, second]) {
      // A run started with the token each context's app sends belongs to that analyst.
      const authorization = (await openApp(each.page)) ?? '';
      const started = await each.context.request.post('/api/runs', {
        headers: { Authorization: authorization },
        data: { action: 'tim.dev_json', params: { rows: [{ id: `${idPrefix}-1` }] } },
      });
      expect(started.ok()).toBe(true);
      owners.push(((await started.json()) as Run).owner);
    }
    expect(owners).toEqual([analyst.upn, second.upn]);
  },
);
