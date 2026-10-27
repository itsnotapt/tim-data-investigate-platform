import type { Page } from '@playwright/test';
import type { components } from '../../src/lib/api/schema';
import { grid, openAction } from '../actionTab';
import { test, expect } from '../realApi';

type Run = components['schemas']['Run'];

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const GONE = 'This result is no longer available';

const rowDetail = (page: Page) => page.getByRole('complementary', { name: 'Row detail' });

/** The grid rows whose Host is `host`. */
const rowsWith = (page: Page, host: string) =>
  grid(page)
    .locator('.ag-row')
    .filter({ has: page.locator('.ag-cell[col-id="Host"]', { hasText: host }) });

/** Opens the development JSON action with `rows`, each row's id from `Host`, and runs it. */
async function runJson(page: Page, rows: Record<string, unknown>[]) {
  await openAction(page, ['Development', 'JSON (development)']);
  await page.getByRole('button', { name: /^Rows: / }).click();
  await page.getByRole('textbox', { name: 'Rows' }).fill(JSON.stringify(rows));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Id column: / }).click();
  await page.getByRole('textbox', { name: 'Id column' }).fill('Host');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: `Results · ${rows.length}` })).toBeVisible();
}

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test('a teammate opens a row link: the rows, the focused row with Row detail open, and Run starts their own run', async ({
  page,
  signIn,
  idPrefix,
}) => {
  const a = `${idPrefix}-a`;
  const b = `${idPrefix}-b`;
  await runJson(page, [{ Host: a }, { Host: b }]);
  // A label, so the teammate's Row detail has a history entry.
  await rowsWith(page, b).locator('.ag-cell[col-id="Host"]').click();
  await page.keyboard.press('1');
  await expect(rowsWith(page, b)).toHaveClass(/tim-label-red/);

  await rowsWith(page, b).locator('.ag-cell[col-id="Host"]').click({ button: 'right' });
  const menu = page.locator('.ag-menu');
  for (const item of ['Copy link', 'Copy', 'Copy with Headers', 'Export']) {
    await expect(menu.getByText(item, { exact: true })).toBeVisible();
  }
  await menu.getByText('Copy link', { exact: true }).click();
  await expect(page.getByText('Copied a link to this row')).toBeVisible();
  const link = await clipboard(page);
  expect(link).toMatch(/#\/runs\/[0-9a-f-]{36}\?row=1$/);

  const teammate = await signIn(`${idPrefix}.teammate@example.com`);
  const started: Run[] = [];
  teammate.page.on('response', async (r) => {
    if (new URL(r.url()).pathname === '/api/runs' && r.request().method() === 'POST') {
      started.push((await r.json()) as Run);
    }
  });
  await teammate.page.goto(link);
  await expect(teammate.page).toHaveURL(/#\/view\//);
  await expect(teammate.page.getByRole('heading', { name: 'JSON (development)' })).toBeVisible();
  await expect(teammate.page.getByRole('button', { name: 'Id column: Host' })).toBeVisible();
  await expect(
    teammate.page.getByRole('tab', { name: 'Results · 2', selected: true }),
  ).toBeVisible();
  await expect(rowsWith(teammate.page, a)).toBeVisible();
  await expect(rowsWith(teammate.page, b)).toHaveClass(/ag-row-focus/);
  await expect(rowDetail(teammate.page).locator('code')).toHaveText(b);
  await expect(rowDetail(teammate.page).getByText('Malicious', { exact: true })).toBeVisible();
  expect(started).toEqual([]);

  await teammate.page.getByRole('button', { name: 'Run' }).click();
  await expect.poll(() => started.map((r) => r.owner)).toEqual([teammate.upn]);
});

test('a link to a run still going fills in when it ends', async ({ page, signIn, idPrefix }) => {
  await openAction(page, ['Development', 'Runs', 'Delayed']);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('progressbar', { name: 'Running' })).toBeVisible();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Copied a link to this result')).toBeVisible();
  const link = await clipboard(page);
  expect(link).toMatch(/#\/runs\/[0-9a-f-]{36}$/);

  const teammate = await signIn(`${idPrefix}.teammate@example.com`);
  await teammate.page.goto(link);
  await expect(teammate.page.getByRole('progressbar', { name: 'Running' })).toBeVisible();
  await expect(teammate.page.getByRole('tab', { name: 'Results · 2' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(grid(teammate.page).getByText('two')).toBeVisible();
});

test('a link to an unknown or expired run shows only that it is gone', async ({ page }) => {
  await page.goto(`/#/runs/${crypto.randomUUID()}?row=1`);
  await expect(page.getByText(GONE)).toBeVisible();
  await expect(page).toHaveURL(/#\/runs\//);
  await expect(page.getByRole('tab')).toHaveCount(0);
});

test('a #/share or #/exportimport URL lands like an unknown route', async ({ page }) => {
  for (const old of [
    '/#/share/11111111-1111-1111-1111-111111111111?p=e30&execute=1',
    '/#/exportimport',
  ]) {
    await page.goto(old);
    await expect(page.getByRole('heading', { name: 'Welcome to TIM' })).toBeVisible();
    await expect(page).toHaveURL(/#\/$/);
  }
});
