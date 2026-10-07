import { test, expect } from '../fixtures';
import { shot } from '../shot';

test('welcome page and account menu', async ({ page, api }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to TIM' })).toBeVisible();
  await expect(page.getByText('The triage and investigation experience.')).toBeVisible();
  await expect(page.getByRole('button', { name: /get started/i })).toBeVisible();
  // Bootstrap loaded the templates with the stub token.
  await expect.poll(() => api.callsTo('GET', '/api/templates/queries').length).toBeGreaterThan(0);
  expect(api.callsTo('GET', '/api/templates/queries')[0]?.authorization).toBe(
    'Bearer dev-stub-token',
  );
  await shot(page, '01-welcome');

  await page.getByRole('button', { name: 'Account' }).click();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await shot(page, '04-menu-account');
});
