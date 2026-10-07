import { test, expect } from '../fixtures';
import { runAdhocQuery } from '../mocks/adhoc-grid';
import { shot } from '../shot';

test('sidebar, column menu and column view', async ({ page }) => {
  await runAdhocQuery(page);
  await expect(page.getByRole('button', { name: /^new$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /run query/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /clone/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /edit query/i })).toBeVisible();
  await expect(page.getByLabel('Quick UI filter')).toBeVisible();

  // 17: sidebar collapsed to the vertical Columns / Filters tabs.
  const columnsTab = page.locator('.ag-side-button').first();
  await columnsTab.click();
  await expect(page.locator('.ag-side-button')).toHaveCount(2);
  await expect(page.getByText('Execution Time')).toBeVisible();
  await shot(page, '17-grid-sidebar-columns');

  // 18: the Filters panel with its searchable column list.
  await page.locator('.ag-side-button').nth(1).click();
  await expect(page.locator('.ag-filter-toolpanel')).toBeVisible();
  await expect(page.locator('.ag-filter-toolpanel')).toContainText('EventTime');
  await expect(page.locator('.ag-filter-toolpanel')).toContainText('TagEvent.Determination');
  await shot(page, '18-grid-sidebar-filters');
  await page.locator('.ag-side-button').nth(1).click();

  // 19: column header menu on State.
  await page
    .locator('.ag-header-cell[col-id="State"] .ag-header-cell-menu-button')
    .click({ force: true });
  await expect(page.getByText('Autosize This Column')).toBeVisible();
  await expect(page.getByText('Group by State')).toBeVisible();
  await shot(page, '19-grid-column-menu');
  await page.keyboard.press('Escape');

  // 20: typing a new column view name offers "Create column view".
  await page.getByRole('combobox', { name: 'Column view' }).click();
  await page.getByRole('combobox', { name: 'Column view' }).fill('Triage layout');
  await expect(page.getByText('Create column view')).toBeVisible();
  await shot(page, '20-column-view-create');
});
