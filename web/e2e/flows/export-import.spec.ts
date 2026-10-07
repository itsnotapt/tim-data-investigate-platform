import { test, expect } from '../fixtures';
import { shot } from '../shot';
import { openRunTemplateTab } from '../mocks/templates';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('export copies tabs JSON to the clipboard, import restores removed tabs', async ({ page }) => {
  await openRunTemplateTab(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Export / Import' }).click();
  await expect(page).toHaveURL(/#\/exportimport/);
  const box = page.getByLabel('Settings (JSON)');
  await expect(page.getByRole('button', { name: 'Import' })).toBeDisabled();

  await page.getByRole('button', { name: 'Export' }).click();
  await expect(
    page.getByText('All settings have been exported and saved to your clipboard.'),
  ).toBeVisible();
  await expect(box).toHaveValue(/"componentName":"TemplateQueryResult"/);
  await shot(page, '40-export-import-exported');

  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(await box.inputValue());
  const tabs = JSON.parse(clip) as { title: string; componentName: string }[];
  expect(tabs).toHaveLength(1);
  expect(tabs[0]?.title).toBe('Storm events in TEXAS');

  // Remove the tab from the tree, then import the backup to bring it back.
  await page.getByLabel('Query tree').hover();
  await page.getByRole('checkbox', { name: 'Select Storm events in TEXAS' }).check();
  await page.getByRole('button', { name: 'Remove selected' }).click();
  await page.mouse.move(900, 500);
  await page.getByLabel('Query tree').hover();
  await expect(page.getByRole('checkbox', { name: /Select /i })).toHaveCount(0);
  await page.mouse.move(900, 500);

  await expect(box).toHaveValue(clip);
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('All settings have been imported.')).toBeVisible();
  await page.getByLabel('Query tree').hover();
  await expect(page.getByRole('checkbox', { name: 'Select Storm events in TEXAS' })).toBeVisible();
});

test('invalid JSON is rejected and Import stays disabled', async ({ page }) => {
  await page.goto('/#/exportimport');
  await page.getByLabel('Settings (JSON)').fill('{ not json');
  await expect(page.getByText('Not valid JSON.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import' })).toBeDisabled();
  await page.getByLabel('Settings (JSON)').fill('[{"componentName":"Nope"}]');
  await expect(page.getByText(/Invalid settings/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import' })).toBeDisabled();
});
