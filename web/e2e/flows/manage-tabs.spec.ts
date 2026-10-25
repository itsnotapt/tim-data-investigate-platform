import { grid, openAction } from '../actionTab';
import { test, expect } from '../realApi';
import { shotHovering } from '../shot';

test('side tree expands on hover, cascade-select and remove tabs', async ({ page }) => {
  await openAction(page, ['Development', 'Rows', 'Sign-ins']);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: 'Results · 4' })).toBeVisible();

  // Collapsed: only icons. Hover expands with the title and selection checkboxes.
  await page.getByLabel('Query tree').hover();
  await expect(page.getByRole('checkbox', { name: 'Select Sign-ins' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove selected' })).toBeDisabled();
  await shotHovering(page, '16-side-tree-expanded');

  // A pivot (Development > Pivots > Sessions for users) creates a child of the action tab.
  await page.mouse.move(900, 500);
  await grid(page).locator('.ag-row[row-index="1"] [col-id="User"]').click({ button: 'right' });
  for (const step of ['Pivot', 'Development', 'Pivots']) {
    await page
      .locator('.ag-menu-option')
      .filter({ hasText: new RegExp(`^${step}$`) })
      .hover();
  }
  await page
    .locator('.ag-menu-option')
    .filter({ hasText: /^Sessions for users$/ })
    .click();
  await expect(page.getByRole('alert').filter({ hasText: 'Sessions for users' })).toBeVisible();

  await page.getByLabel('Query tree').hover();
  await expect(page.getByRole('checkbox', { name: /Select /i })).toHaveCount(2);

  // Checking the parent cascades to its child; Remove deletes both and returns home.
  await page.getByRole('checkbox', { name: 'Select Sign-ins' }).check();
  await expect(page.getByRole('checkbox', { name: /Select /i }).nth(1)).toBeChecked();
  await page.getByRole('button', { name: 'Remove selected' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('checkbox', { name: /Select /i })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Welcome to TIM' })).toBeVisible();
});
