import { devStubToken } from '../../src/lib/auth/devStubAuth';
import { test, expect } from '../realApi';
import { shot } from '../shot';

test('welcome page and account menu', async ({ page, analyst }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Bootstrap loads the instance with the signed-in analyst's stub token.
  const instance = page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/instance',
  );
  await page.goto('/');
  const response = await instance;
  expect(response.status()).toBe(200);
  expect(await response.request().headerValue('authorization')).toBe(
    `Bearer ${devStubToken(analyst.upn)}`,
  );
  await expect(page.getByRole('heading', { name: 'Welcome to TIM' })).toBeVisible();
  await expect(page.getByText('The triage and investigation experience.')).toBeVisible();
  await expect(page.getByRole('button', { name: /get started/i })).toBeVisible();
  await shot(page, '01-welcome');

  await page.getByRole('button', { name: 'Account' }).click();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await shot(page, '04-menu-account');
  expect(errors, 'uncaught page errors').toEqual([]);
});
