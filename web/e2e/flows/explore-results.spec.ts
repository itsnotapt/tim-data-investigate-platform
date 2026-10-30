import { grid } from '../actionTab';
import { test, expect } from '../realApi';
import { shot } from '../shot';
import { runJsonRows } from '../stormRows';

test('sidebar and column menu', async ({ page }) => {
  await runJsonRows(page);
  await expect(page.getByLabel('Filter rows')).toBeVisible();

  // 17: sidebar collapsed to the vertical Columns / Filters / Views / Action file tabs.
  const sideButtons = grid(page).locator('.ag-side-button');
  await expect(sideButtons).toHaveCount(4);
  await sideButtons.first().click();
  await expect(grid(page).locator('.ag-column-select')).toContainText('EventTime');
  await shot(page, '17-grid-sidebar-columns');

  // 18: the Filters panel with its searchable column list.
  await sideButtons.nth(1).click();
  await expect(grid(page).locator('.ag-filter-toolpanel')).toBeVisible();
  await expect(grid(page).locator('.ag-filter-toolpanel')).toContainText('EventTime');
  await shot(page, '18-grid-sidebar-filters');
  await sideButtons.nth(1).click();

  // 19: column header menu on State.
  await grid(page)
    .locator('.ag-header-cell[col-id="State"] .ag-header-cell-menu-button')
    .click({ force: true });
  await expect(page.getByText('Autosize This Column')).toBeVisible();
  await expect(page.getByText('Group by State')).toBeVisible();
  await shot(page, '19-grid-column-menu');
  await page.keyboard.press('Escape');
});
