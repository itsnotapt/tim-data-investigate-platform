import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures';
import { rightClickState, runAdhocQuery } from '../mocks/adhoc-grid';
import { shot, shotHovering } from '../shot';

test('quick tag submenu, then the customise dialog', async ({ page, api }) => {
  await runAdhocQuery(page);

  await rightClickState(page, 1);
  await page.locator('.ag-menu-option:has-text("Tag Events")').hover();
  for (const item of [
    'Customise tag events',
    'Quick - Malicious',
    'Quick - Suspicious',
    'Quick - Benign',
  ]) {
    await expect(page.locator('.ag-menu-option', { hasText: item })).toBeVisible();
  }
  await shotHovering(page, '22-grid-context-menu-tag');

  // Quick tag the clicked (unsaved) row: saved-events then comments are posted.
  await page.locator('.ag-menu-option', { hasText: 'Quick - Malicious' }).click();
  await expect
    .poll(() => api.callsTo('POST', /\/api\/taggedevents\//).map((c) => c.path))
    .toEqual(
      expect.arrayContaining(['/api/taggedevents/savedEvents', '/api/taggedevents/comments']),
    );

  // Select two rows and open the detailed dialog.
  await page.locator('.ag-row[row-index="2"] .ag-checkbox-input').first().check({ force: true });
  await page.locator('.ag-row[row-index="3"] .ag-checkbox-input').first().check({ force: true });
  await rightClickState(page, 2);
  await page.locator('.ag-menu-option:has-text("Tag Events")').hover();
  await page.locator('.ag-menu-option', { hasText: 'Customise tag events' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Customise Tag Events');
  await expect(dialog).toContainText('2 event(s) selected');
  await expect(dialog.getByLabel('Determination', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Comment', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Tags', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /close/i })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^save$/i })).toBeVisible();
  await shot(page, '25-tag-event-dialog');
});

test('determination symbols start off, toggle from the checkbox column and are remembered', async ({
  page,
}) => {
  await runAdhocQuery(page);
  const selectionCell = (rowIndex: number) =>
    page.locator(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="ag-Grid-SelectionColumn"]`);
  const toggle = page.locator('.ag-menu-option', { hasText: 'Show determination symbols' });

  const expectSymbols = async () => {
    await expect(selectionCell(0).getByRole('img', { name: 'Malicious' })).toBeVisible();
    await expect(selectionCell(5).getByRole('img', { name: 'Suspicious' })).toBeVisible();
    await expect(selectionCell(10).getByRole('img', { name: 'Benign' })).toBeVisible();
    await expect(selectionCell(1).getByRole('img')).toHaveCount(0);
  };

  await expect(selectionCell(0).getByRole('checkbox')).toBeAttached();
  await expect(
    page.locator('.ag-cell[col-id="ag-Grid-SelectionColumn"]').getByRole('img'),
  ).toHaveCount(0);

  await selectionCell(0).click({ button: 'right' });
  await toggle.click();
  await expectSymbols();

  // Each symbol is 16px tall, centred on the checkbox, with the cell's 7px padding after the widest.
  const box = async (locator: Locator) => (await locator.boundingBox())!;
  const checkbox = await box(selectionCell(5).locator('.ag-checkbox-input-wrapper'));
  const warning = await box(selectionCell(5).getByRole('img', { name: 'Suspicious' }));
  const cell = await box(selectionCell(5));
  expect(warning.height).toBeCloseTo(16, 0);
  expect(warning.y + warning.height / 2).toBeCloseTo(checkbox.y + checkbox.height / 2, 0);
  expect(cell.x + cell.width - (warning.x + warning.width)).toBeLessThanOrEqual(8);

  await page.evaluate(() => document.documentElement.setAttribute('data-ag-theme-mode', 'dark'));
  await expectSymbols();

  await page.reload();
  await runAdhocQuery(page);
  await expectSymbols();

  await page
    .locator('.ag-header-cell[col-id="ag-Grid-SelectionColumn"]')
    .click({ button: 'right', position: { x: 26, y: 10 } });
  await toggle.click();
  await expect(
    page.locator('.ag-cell[col-id="ag-Grid-SelectionColumn"]').getByRole('img'),
  ).toHaveCount(0);
});
