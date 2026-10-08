import { test, expect } from '../fixtures';
import { shotHovering } from '../shot';

async function runNewQuery(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /get started/i }).click();
  await page.getByRole('menuitem', { name: 'New query' }).click();
  await page.getByLabel('Cluster').first().click();
  await page.getByRole('option', { name: 'https://help.kusto.windows.net' }).first().click();
  await page.getByLabel('Database').first().click();
  await page.getByRole('option', { name: 'Samples' }).first().click();
  await page.getByRole('button', { name: /save changes & run/i }).click();
  await expect(page.locator('.ag-row').first()).toBeVisible();
}

test('side tree expands on hover, cascade-select and remove tabs', async ({ page }) => {
  await runNewQuery(page);

  // Collapsed: only icons. Hover expands with the title and selection checkboxes.
  await page.getByLabel('Query tree').hover();
  await expect(page.getByText('New query', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload templates' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove selected' })).toBeDisabled();
  await shotHovering(page, '16-side-tree-expanded');

  // Pivot (Weather > Storms > Storm events for state) creates a child of the query.
  await page.mouse.move(900, 500);
  await page.locator('.ag-row[row-index="1"] .ag-cell[col-id="State"]').click({ button: 'right' });
  await page.locator('.ag-menu-option:has-text("Weather")').hover();
  await page.locator('.ag-menu-option:has-text("Storms")').hover();
  await page.locator('.ag-menu-option:has-text("Storm events for state")').click();
  await expect(page).toHaveURL(/#\/view\//);

  await page.getByLabel('Query tree').hover();
  await expect(page.getByRole('checkbox', { name: /Select /i })).toHaveCount(2);

  // Checking the parent cascades to its child; Remove deletes both and returns home.
  await page.getByRole('checkbox', { name: 'Select New query' }).check();
  await expect(page.getByRole('checkbox', { name: /Select /i }).nth(1)).toBeChecked();
  await page.getByRole('button', { name: 'Remove selected' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('checkbox', { name: /Select /i })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Welcome to TIM' })).toBeVisible();
});

test('Reload templates refetches the template list', async ({ page, api }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to TIM' })).toBeVisible();
  const before = api.callsTo('GET', '/api/templates/queries').length;
  await page.getByLabel('Query tree').hover();
  await page.getByRole('button', { name: 'Reload templates' }).click();
  await expect
    .poll(() => api.callsTo('GET', '/api/templates/queries').length)
    .toBeGreaterThan(before);
});
