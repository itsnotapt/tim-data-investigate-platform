import type { Page } from '@playwright/test';
import { grid, openAction } from '../actionTab';
import { test, expect } from '../realApi';

/** Opens and runs an action of the Rows folder, waiting for its `rows` rows. */
async function runRows(page: Page, name: string, rows: number) {
  await openAction(page, ['Development', 'Rows', name]);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: `Results · ${rows}` })).toBeVisible();
}

const row = (page: Page, index: number) => grid(page).locator(`.ag-row[row-index="${index}"]`);
const select = (page: Page, index: number) =>
  row(page, index).locator('.ag-checkbox-input').first().check({ force: true });
const menuOption = (page: Page, name: string) =>
  page.locator('.ag-menu-option').filter({ hasText: new RegExp(`^${name}$`) });

/** Right-clicks a cell, then hovers through Pivot ▸ and `folders`. */
async function openPivotMenu(page: Page, index: number, column: string, folders: string[]) {
  await row(page, index).locator(`[col-id="${column}"]`).click({ button: 'right' });
  for (const step of ['Pivot', ...folders]) await menuOption(page, step).hover();
}

/** Pivots from a row's cell with the preset `name` in the folder `folder`, then goes to its tab. */
async function pivotWithPreset(page: Page, index: number, folder: string, name: string) {
  await openPivotMenu(page, index, 'Result', [folder]);
  await menuOption(page, name).click();
  const toast = page.getByRole('alert').filter({ hasText: `Running ${name}` });
  await expect(toast).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign-ins', exact: true })).toBeVisible();
  await toast.getByRole('button', { name: 'Go to' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('a shared From row preset pivots from a row into a child tab, for its owner and for another analyst', async ({
  page,
  idPrefix,
  signIn,
}) => {
  const name = `${idPrefix} Same result`;

  // Alice saves a shared preset of Sign-ins with a result that takes Result from the row.
  await openAction(page, ['Development', 'Pivots', 'Sign-ins with a result']);
  await page.getByRole('button', { name: 'Save…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save preset' });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Menu folder').fill(idPrefix);
  await dialog.getByLabel('Share with everyone').check();
  await dialog.getByRole('button', { name: 'Result from the row' }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  // She pivots with it from one row of Sign-ins; the child tab runs with the row's Result.
  await runRows(page, 'Sign-ins', 4);
  await pivotWithPreset(page, 1, idPrefix, name);
  await expect(page.getByRole('button', { name: 'Result: Failure' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Results · 2' })).toBeVisible();

  // Rows that disagree on Result disable it, with the reason.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Sign-ins', exact: true })).toBeVisible();
  await select(page, 0);
  await select(page, 1);
  await openPivotMenu(page, 0, 'Result', [idPrefix]);
  const preset = menuOption(page, name);
  await expect(preset).toHaveClass(/ag-menu-option-disabled/);
  await preset.hover();
  await expect(page.getByText('The 2 selected rows have different Result values')).toBeVisible();
  await page.keyboard.press('Escape');

  // Rows without a Result column don't offer it.
  await runRows(page, 'Generated rows', 2500);
  await openPivotMenu(page, 0, 'Host', []);
  await expect(menuOption(page, 'Development')).toBeVisible();
  await expect(menuOption(page, idPrefix)).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Bob pivots with Alice's shared preset too.
  const bob = await signIn(`${idPrefix}.bob@example.com`);
  await runRows(bob.page, 'Sign-ins', 4);
  await pivotWithPreset(bob.page, 0, idPrefix, name);
  await expect(bob.page.getByRole('button', { name: 'Result: Success' })).toBeVisible();
  await expect(bob.page.getByRole('tab', { name: 'Results · 2' })).toBeVisible();
});
