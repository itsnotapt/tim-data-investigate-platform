import type { Page } from '@playwright/test';
import { grid, openAction } from '../actionTab';
import { test, expect } from '../realApi';

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
      body: JSON.stringify({
        type: 'urn:tim:problem:not-found',
        title: 'Not found',
        status: 404,
      }),
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

const runTab = (page: Page) => page.getByRole('tab', { name: /^Run/ });

test('a second run dims the first one’s results, and cancelling it keeps them under a note', async ({
  page,
}) => {
  await openAction(page, ['Development', 'Runs', 'Delayed']);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: 'Results · 2' })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('progressbar', { name: 'Running' })).toBeVisible();
  await expect(page.getByText(/^Showing the run from \d{4}-\d{2}-\d{2} /)).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Results · 2' })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  await expect(grid(page).getByText('two')).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(runTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run' })).toBeVisible();

  await page.getByRole('tab', { name: 'Results · 2' }).click();
  await expect(page.getByText(/^The last run was cancelled\. Showing the run from /)).toBeVisible();
  await expect(grid(page).getByText('two')).toBeVisible();
});

test('a run that ends in error shows the Run tab with the error and the run’s details', async ({
  page,
}) => {
  await openAction(page, ['Development', 'Runs', 'Failing']);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(runTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('alert')).toHaveText('The sign-in log is unavailable');
  const details = page.getByRole('table', { name: 'Details' });
  await expect(details.getByRole('row', { name: /cluster/ })).toContainText('dev');
  await expect(details.getByRole('row', { name: /scanned/ })).toContainText('1200');
});

/** Opens the development JSON action and sets its rows. */
async function openJson(page: Page, rows: string) {
  await openAction(page, ['Development', 'JSON (development)']);
  await setRows(page, rows);
}

async function setRows(page: Page, rows: string) {
  await page.getByRole('button', { name: /^Rows: / }).click();
  await page.getByRole('textbox', { name: 'Rows' }).fill(rows);
  await page.keyboard.press('Escape');
}

test('a failed run keeps the last good results under a note; Edited resets the params', async ({
  page,
  idPrefix,
}) => {
  await openJson(page, JSON.stringify([{ Host: `${idPrefix}-web-1` }]));
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: 'Results · 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edited' })).toHaveCount(0);

  await setRows(page, JSON.stringify({ Host: 'not a list' }));
  await page.getByRole('button', { name: 'Edited' }).click();
  await expect(page.getByRole('button', { name: 'Edited' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Rows: .*web-1/ })).toBeVisible();

  await setRows(page, JSON.stringify({ Host: 'not a list' }));
  await expect(page.getByRole('button', { name: 'Edited' })).toBeVisible();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(runTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('alert')).toHaveText('Rows must be a JSON array of objects');
  await expect(page.getByRole('button', { name: 'Edited' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Results · 1' }).click();
  await expect(page.getByText(/^The last run failed\. Showing the run from /)).toBeVisible();
  await expect(grid(page).getByText(`${idPrefix}-web-1`)).toBeVisible();
});

test('a param the server refuses is marked on its pill', async ({ page }) => {
  await openAction(page, ['Development', 'JSON (development)']);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('button', { name: 'Rows: not set' })).toHaveAccessibleDescription(
    'Required',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a run that cannot start says why on the Run tab', async ({ page }) => {
  await openAction(page, ['Development', 'Runs', 'Failing']);
  // The dev actions reach no connection, so the api cannot fail a start this way.
  await page.route('**/api/runs', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'urn:tim:problem:upstream',
        title: 'Bad gateway',
        status: 502,
        detail: 'No token for the connection',
      }),
    }),
  );
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(runTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('alert')).toHaveText("Couldn't start: No token for the connection");
});

test('Clone opens a copy of the tab with the same params', async ({ page }) => {
  await openAction(page, ['Development', 'Rows', 'Sign-ins']);
  await page.getByRole('button', { name: 'Users: not set' }).click();
  const users = page.getByRole('textbox', { name: 'Add Users' });
  await users.fill('alice@example.com');
  await users.press('Enter');
  await page.keyboard.press('Escape');
  const original = page.url();

  await page.getByRole('button', { name: 'Clone' }).click();
  await expect(page.getByRole('heading', { name: 'Copy of Sign-ins' })).toBeVisible();
  expect(page.url()).not.toBe(original);
  await expect(page.getByRole('button', { name: 'Users: alice@example.com' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Results', exact: true })).toBeVisible();
});
