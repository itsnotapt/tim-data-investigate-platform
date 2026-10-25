import { test, expect } from '../fixtures';

test('cloning a Kusto tab opens a new root tab with the same query', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /get started/i }).click();
  await page.getByRole('menuitem', { name: 'New query' }).click();
  await page.getByLabel('Summary').fill('My investigation');
  await page.getByLabel('Cluster').first().click();
  await page.getByRole('option', { name: 'https://help.kusto.windows.net' }).first().click();
  await page.getByLabel('Database').first().click();
  await page.getByRole('option', { name: 'Samples' }).first().click();
  await page.getByRole('button', { name: /save changes & run/i }).click();
  await expect(page.locator('.ag-row').first()).toBeVisible();
  const original = page.url();

  await page.getByRole('button', { name: 'Clone' }).click();
  await expect(page).not.toHaveURL(original);
  // Clone is not auto-run: no grid, the copy is shown with its own title in the tree.
  await page.getByLabel('Query tree').hover();
  await expect(page.getByText('Copy of My investigation')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Select /i })).toHaveCount(2);
});
