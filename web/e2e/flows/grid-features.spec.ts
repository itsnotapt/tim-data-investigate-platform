import type { Page } from '@playwright/test';
import { grid } from '../actionTab';
import { test, expect } from '../realApi';
import { rightClickState, runJsonRows } from '../stormRows';

// Exercises the AG Grid features that need a registered module (see agGridSetup.ts). Each test
// fails on AG Grid console errors, e.g. #200 "missing module". The trial-licence banner (no licence
// key in e2e) is expected and ignored.
const gridMessages = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const messages: string[] = [];
  gridMessages.set(page, messages);
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (!/AG Grid/i.test(text) || /Enterprise License|unlocked for trial/i.test(text)) return;
    messages.push(`${m.type()}: ${text}`);
  });
});

test.afterEach(({ page }) => {
  expect(gridMessages.get(page), 'AG Grid console errors').toEqual([]);
});

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('quick filter, set filter and the filters side bar', async ({ page }) => {
  await runJsonRows(page);
  const status = page.locator('.ag-status-bar');
  await expect(status).toContainText('Total Rows');

  await page.getByLabel('Quick UI filter').fill('KANSAS');
  await expect(status).toContainText('Filtered');
  await expect(grid(page).locator('.ag-row[row-index="0"] .ag-cell[col-id="State"]')).toHaveText(
    'KANSAS',
  );
  await page.getByLabel('Quick UI filter').fill('');

  // Multi filter: sub-menu text filter plus the set filter, from the header filter button.
  await grid(page)
    .locator('.ag-header-cell[col-id="State"] .ag-header-cell-filter-button')
    .click({ force: true });
  await expect(page.locator('.ag-multi-filter-menu-item').first()).toBeVisible();
  await expect(page.locator('.ag-set-filter')).toBeVisible();
  await page.locator('.ag-set-filter-item', { hasText: 'IOWA' }).locator('input').first().uncheck();
  await expect(grid(page).locator('.ag-row [col-id="State"]', { hasText: 'IOWA' })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('row grouping with group rows', async ({ page }) => {
  await runJsonRows(page);
  await grid(page)
    .locator('.ag-header-cell[col-id="State"] .ag-header-cell-menu-button')
    .click({ force: true });
  await page.getByText('Group by State').click();
  await expect(grid(page).locator('.ag-row-group').first()).toBeVisible();
  await expect(grid(page).locator('.ag-row-group', { hasText: 'KANSAS' }).first()).toBeVisible();
});

test('context menu copy and export', async ({ page }) => {
  await runJsonRows(page);

  await rightClickState(page, 1);
  await page.locator('.ag-menu').getByText('Copy', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('KANSAS');

  await rightClickState(page, 1);
  await page.locator('.ag-menu-option', { hasText: 'Export' }).hover();
  await expect(page.locator('.ag-menu-option', { hasText: 'Excel Export' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.locator('.ag-menu-option', { hasText: 'CSV Export' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);

  // Excel export builds the workbook (needs the Excel module).
  await rightClickState(page, 1);
  await page.locator('.ag-menu-option', { hasText: 'Export' }).hover();
  const xlsx = page.waitForEvent('download');
  await page.locator('.ag-menu-option', { hasText: 'Excel Export' }).click();
  expect((await xlsx).suggestedFilename()).toMatch(/\.xlsx$/);
});

test('the Columns tool panel has the pivot mode toggle', async ({ page }) => {
  await runJsonRows(page);
  // Retry the click: the grid is still settling right after the run.
  await expect(async () => {
    await grid(page).locator('.ag-side-button').first().click();
    await expect(grid(page).locator('.ag-column-select')).toBeVisible({ timeout: 1500 });
  }).toPass();
  // Pivot mode toggle of the Columns tool panel (needs the pivot module).
  await expect(grid(page).locator('.ag-pivot-mode-panel')).toBeVisible();
});
