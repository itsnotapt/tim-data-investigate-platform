import { test, expect } from '../fixtures';
import { shot } from '../shot';
import { openRunTemplateTab } from '../mocks/flows-b';

test('W9 convert a template tab to a custom KQL query (screen 30)', async ({ page }) => {
  await openRunTemplateTab(page);
  await expect(page.getByRole('button', { name: 'Share Link' })).toBeVisible();

  await page.getByRole('button', { name: 'Convert' }).click();
  const dialog = page.getByRole('dialog', { name: 'Convert to custom query?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('making all parameters constant');
  await expect(dialog).toContainText('permanent and cannot be undone');
  await shot(page, '30-template-convert-dialog');

  // Cancel leaves the template tab untouched.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Share Link' })).toBeVisible();

  await page.getByRole('button', { name: 'Convert' }).click();
  await dialog.getByRole('button', { name: 'Convert' }).click();
  await expect(dialog).toBeHidden();

  // Now an ad-hoc Kusto tab (opens in edit mode): Kusto actions, template-only buttons gone.
  await expect(page.getByRole('button', { name: 'Save Changes & Run' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Time range: Last 15 minutes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share Link' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Convert' })).toHaveCount(0);

  // The rendered KQL has the parameters substituted (constant).
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText(
    "State == 'TEXAS'",
  );
});
