import type { Page } from '@playwright/test';
import { test, expect } from '../realApi';

/** Opens an action from the welcome page's New menu, through its menu path. */
async function openAction(page: Page, path: string[]) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  for (const step of path) await page.getByRole('button', { name: step, exact: true }).click();
}

const grid = (page: Page) => page.getByTestId('results-grid');

test('an action opened from the New menu runs with a pill’s value, and its rows survive a reload and the run’s expiry', async ({
  page,
}) => {
  await openAction(page, ['Development', 'Rows', 'Sign-ins']);
  await expect(page).toHaveURL(/\/view\//);
  await expect(page.getByRole('heading', { name: 'Sign-ins' })).toBeVisible();

  await page.getByRole('button', { name: 'Users: not set' }).click();
  const users = page.getByRole('textbox', { name: 'Add Users' });
  await users.fill('alice@example.com');
  await users.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Users: alice@example.com' })).toBeVisible();

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: 'Results · 2' })).toBeVisible();
  await expect(grid(page).getByText('c-1')).toBeVisible();
  await expect(grid(page).getByText('c-3')).toBeVisible();
  await expect(grid(page).getByText('bob@example.com')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('tab', { name: 'Results · 2' })).toBeVisible();
  await expect(grid(page).getByText('c-3')).toBeVisible();

  // The run has expired: the server no longer knows it. The rows come from IndexedDB.
  await page.route('**/api/runs/**', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/problem+json',
      body: JSON.stringify({ type: 'urn:tim:problem:not-found', title: 'Not found', status: 404 }),
    }),
  );
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Results · 2' })).toBeVisible();
  await expect(grid(page).getByText('c-1')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a long run is picked up again after a reload', async ({ page }) => {
  await openAction(page, ['Development', 'Runs', 'Delayed']);
  const started = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/runs' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Run' }).click();
  expect((await started).status()).toBe(202);
  await expect(page.getByRole('progressbar', { name: 'Running' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('progressbar', { name: 'Running' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Results · 2' })).toBeVisible({ timeout: 20_000 });
  await expect(grid(page).getByText('two')).toBeVisible();
});

test('a run that succeeds with no rows says so', async ({ page }) => {
  await openAction(page, ['Development', 'Rows', 'Sign-ins']);
  await page.getByRole('button', { name: 'Users: not set' }).click();
  const users = page.getByRole('textbox', { name: 'Add Users' });
  await users.fill('nobody@example.com');
  await users.press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: 'Results · 0' })).toBeVisible();
  await expect(page.getByText('The run succeeded with no rows.')).toBeVisible();
});
