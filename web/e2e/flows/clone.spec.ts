import { test, expect } from '../fixtures';
import { openRunTemplateTab } from '../mocks/templates';

test('cloning a template tab opens a sibling "Copy of ..." in edit mode', async ({ page }) => {
  await openRunTemplateTab(page);
  const original = page.url();

  await page.getByRole('button', { name: 'Clone' }).click();
  await expect(page).not.toHaveURL(original);
  await expect(page.getByRole('textbox', { name: 'Summary' })).toHaveValue(
    'Copy of Storm events in TEXAS',
  );
  await expect(page.getByRole('textbox', { name: 'State' })).toHaveValue('TEXAS');
  await expect(page.getByRole('button', { name: 'Save & Run' })).toBeVisible();

  // Both are root tabs in the tree (same parent: none).
  await page.getByLabel('Query tree').hover();
  await expect(page.getByText('Storm events in TEXAS', { exact: true })).toBeVisible();
  await expect(page.getByText('Copy of Storm events in TEXAS')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Select /i })).toHaveCount(2);
});

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
