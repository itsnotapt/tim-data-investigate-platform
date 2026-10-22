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
const selected = (page: Page, count: string) =>
  expect(grid(page).locator('.ag-status-bar')).toContainText(
    new RegExp(`Selected\\s*:\\s*${count}`),
  );
const menuOption = (page: Page, name: string) =>
  page.locator('.ag-menu-option').filter({ hasText: new RegExp(`^${name}$`) });

/** Right-clicks a cell, then follows `path` through Pivot ▸. */
async function pivot(page: Page, index: number, column: string, path: string[]) {
  await row(page, index).locator(`[col-id="${column}"]`).click({ button: 'right' });
  for (const step of ['Pivot', ...path.slice(0, -1)]) await menuOption(page, step).hover();
  await menuOption(page, path.at(-1)!).click();
}

test('a pivot from one row opens a child tab in the background, which runs, and Go to focuses it', async ({
  page,
}) => {
  await runRows(page, 'Sign-ins', 4);
  const parent = page.url();

  await pivot(page, 1, 'User', ['Development', 'Pivots', 'Sessions for users']);
  const toast = page.getByRole('alert').filter({ hasText: 'Running Sessions for users' });
  await expect(toast).toBeVisible();
  expect(page.url()).toBe(parent);
  await expect(page.getByRole('heading', { name: 'Sign-ins' })).toBeVisible();

  await toast.getByRole('button', { name: 'Go to' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions for users' })).toBeVisible();
  expect(page.url()).not.toBe(parent);
  await expect(page.getByRole('button', { name: 'Users: bob@example.com' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Results · 1' })).toBeVisible();
  await expect(grid(page).getByText('s-bob-1')).toBeVisible();

  // Recent lists the pivot, with its menu path.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Sign-ins' })).toBeVisible();
  await row(page, 0).locator('[col-id="User"]').click({ button: 'right' });
  await menuOption(page, 'Pivot').hover();
  await expect(menuOption(page, 'Recent')).toBeVisible();
  await expect(menuOption(page, 'Development / Pivots / Sessions for users')).toBeVisible();
});

test('a pivot from several rows takes the selected rows, and a right-click outside them selects just its row', async ({
  page,
}) => {
  await runRows(page, 'Sign-ins', 4);

  await select(page, 0);
  await select(page, 1);
  await pivot(page, 0, 'User', ['Development', 'Pivots', 'Sessions for users']);
  await page
    .getByRole('alert')
    .filter({ hasText: 'Running Sessions for users' })
    .getByRole('button', { name: 'Go to' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Users: alice@example.com, bob@example.com' }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Results · 3' })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Sign-ins' })).toBeVisible();
  await select(page, 0);
  await select(page, 1);
  await pivot(page, 3, 'User', ['Development', 'Pivots', 'Sessions for users']);
  await selected(page, '1');
  await page
    .getByRole('alert')
    .filter({ hasText: 'Running Sessions for users' })
    .getByRole('button', { name: 'Go to' })
    .click();
  await expect(page.getByRole('button', { name: 'Users: carol@example.com' })).toBeVisible();
});

test('a pivot whose rows disagree waits for the param, with the reason, and runs once it is filled', async ({
  page,
}) => {
  await runRows(page, 'Sign-ins', 4);

  await select(page, 0);
  await select(page, 2);
  await pivot(page, 0, 'Result', ['Development', 'Pivots', 'Sign-ins with a result']);
  const toast = page
    .getByRole('alert')
    .filter({ hasText: 'Opened Sign-ins with a result: needs Result' });
  await expect(toast).toBeVisible();

  const tree = page.getByLabel('Query tree');
  await tree.hover();
  await expect(tree.getByRole('img', { name: 'Needs input' })).toBeVisible();

  await toast.getByRole('button', { name: 'Go to' }).click();
  // The first missing pill's popover is open.
  const result = page.getByRole('textbox', { name: 'Result' });
  await expect(result).toBeVisible();
  await expect(page.getByText('Fill in Result to run this pivot')).toBeVisible();
  await expect(page.getByText('The 2 selected rows have different Result values')).toBeVisible();
  await result.fill('Failure');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Sign-ins with a result' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Result: Failure' })).toBeVisible();

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: 'Results · 2' })).toBeVisible();
  await expect(page.getByText('Fill in Result to run this pivot')).toHaveCount(0);
});

test('pivots are disabled, with the reason, for several rows into a one-row action and over the row cap', async ({
  page,
}) => {
  await runRows(page, 'Generated rows', 2500);

  await select(page, 0);
  await select(page, 1);
  await row(page, 0).locator('[col-id="Host"]').click({ button: 'right' });
  for (const step of ['Pivot', 'Development', 'Pivots']) await menuOption(page, step).hover();
  const host = menuOption(page, 'Host details');
  await expect(host).toHaveClass(/ag-menu-option-disabled/);
  await host.hover();
  await expect(page.getByText('Takes one row')).toBeVisible();
  await page.keyboard.press('Escape');

  await grid(page).locator('.ag-header-select-all .ag-checkbox-input').check({ force: true });
  await selected(page, '2,500');
  await row(page, 0).locator('[col-id="Host"]').click({ button: 'right' });
  const pivots = menuOption(page, 'Pivot');
  await expect(pivots).toHaveClass(/ag-menu-option-disabled/);
  await pivots.hover();
  await expect(page.getByText('At most 100 rows; 2,500 selected')).toBeVisible();
});
