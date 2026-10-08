import { test, expect } from '../fixtures';
import { rightClickState, runAdhocQuery } from '../mocks/adhoc-grid';

// Exercises the AG Grid features that need a registered module (see agGridSetup.ts). The fixture
// fails each test on AG Grid console errors, e.g. #200 "missing module".
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('quick filter, set filter and the filters side bar', async ({ page }) => {
  await runAdhocQuery(page);
  const status = page.locator('.ag-status-bar');
  await expect(status).toContainText('Total Rows');

  await page.getByLabel('Quick UI filter').fill('KANSAS');
  await expect(status).toContainText('Filtered');
  await expect(page.locator('.ag-row[row-index="0"] .ag-cell[col-id="State"]')).toHaveText(
    'KANSAS',
  );
  await page.getByLabel('Quick UI filter').fill('');

  // Multi filter: sub-menu text filter plus the set filter, from the header filter button.
  await page
    .locator('.ag-header-cell[col-id="State"] .ag-header-cell-filter-button')
    .click({ force: true });
  await expect(page.locator('.ag-multi-filter-menu-item').first()).toBeVisible();
  await expect(page.locator('.ag-set-filter')).toBeVisible();
  await page.locator('.ag-set-filter-item', { hasText: 'IOWA' }).locator('input').first().uncheck();
  await expect(page.locator('.ag-row [col-id="State"]', { hasText: 'IOWA' })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('row grouping with group rows', async ({ page }) => {
  await runAdhocQuery(page);
  await page
    .locator('.ag-header-cell[col-id="State"] .ag-header-cell-menu-button')
    .click({ force: true });
  await page.getByText('Group by State').click();
  await expect(page.locator('.ag-row-group').first()).toBeVisible();
  await expect(page.locator('.ag-row-group', { hasText: 'KANSAS' }).first()).toBeVisible();
});

test('context menu copy and export', async ({ page }) => {
  await runAdhocQuery(page);

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

test('comment cell editor', async ({ page }) => {
  await runAdhocQuery(page);
  // The hidden comment column, shown via the Columns tool panel; row 0 is a saved, tagged event.
  await expect(page.locator('.ag-side-button')).toHaveCount(2);
  // Retry the click: the grid is still settling right after the run.
  await expect(async () => {
    await page.locator('.ag-side-button').first().click();
    await expect(page.locator('.ag-column-select')).toBeVisible({ timeout: 1500 });
  }).toPass();
  // Pivot mode toggle of the Columns tool panel (needs the pivot module).
  await expect(page.locator('.ag-pivot-mode-panel')).toBeVisible();
  await page.locator('.ag-column-select-header-filter-wrapper input').fill('TagEvent.Comment');
  await page
    .locator('.ag-column-select-column', { hasText: 'TagEvent.Comment' })
    .locator('.ag-column-select-checkbox')
    .click();
  await page.locator('.ag-side-button').first().click();
  // Columns are virtualised horizontally: scroll the new (last) column into view.
  await page.locator('.ag-body-horizontal-scroll-viewport').evaluate((e) => (e.scrollLeft = 1e6));
  const cell = page.locator('.ag-row[row-index="0"] .ag-cell[col-id="TagEvent.Comment"]');
  await cell.dblclick();
  await expect(page.locator('.ag-large-text-input textarea')).toBeVisible();
  await page.keyboard.press('Escape');
});
