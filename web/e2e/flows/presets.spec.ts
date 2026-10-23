import type { Page } from '@playwright/test';
import { openAction } from '../actionTab';
import { test, expect } from '../realApi';

/** Opens the welcome page's New menu, which fetches the presets afresh, and searches it. */
async function searchNewMenu(page: Page, search: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByLabel('Search queries').fill(search);
  return page.getByRole('menu').first();
}

async function more(page: Page, name: string) {
  await page.getByRole('button', { name: `More for ${name}` }).click();
  return page.getByRole('menu', { name });
}

test('an analyst saves, shares, edits and deletes a preset, and another hides and duplicates it', async ({
  page,
  analyst,
  idPrefix,
  signIn,
}) => {
  const name = `${idPrefix} Alice's sign-ins`;

  // Alice saves a tab as a private bookmark.
  await openAction(page, ['Development', 'Rows', 'Sign-ins']);
  await page.getByRole('button', { name: 'Users: not set' }).click();
  const users = page.getByRole('textbox', { name: 'Add Users' });
  await users.fill('alice@example.com');
  await users.press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save…' }).click();
  let dialog = page.getByRole('dialog', { name: 'Save preset' });
  await expect(dialog.getByText('Users = alice@example.com')).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name })).toBeVisible();

  // She finds it by search and opens it.
  let menu = await searchNewMenu(page, idPrefix);
  await expect(menu.getByText(`Bookmark · ${analyst.upn}`)).toBeVisible();
  await menu.getByText(name, { exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Users: alice@example.com' })).toBeVisible();

  // She shares it.
  await searchNewMenu(page, idPrefix);
  await (await more(page, name)).getByRole('menuitem', { name: 'Share with everyone' }).click();
  await expect(page.getByRole('button', { name: `More for ${name}` })).toBeVisible();
  await page.keyboard.press('Escape');

  // Bob sees it read-only, hides it, and duplicates it.
  const bob = await signIn(`${idPrefix}.bob@example.com`);
  menu = await searchNewMenu(bob.page, idPrefix);
  await expect(menu.getByText(name, { exact: true })).toBeVisible();
  let items = await more(bob.page, name);
  await expect(items.getByRole('menuitem')).toHaveText(['Open', 'Duplicate', 'Hide']);
  await items.getByRole('menuitem', { name: 'Hide' }).click();
  await expect(menu.getByText(name, { exact: true })).toBeHidden();
  await bob.page.getByRole('button', { name: 'Hidden', exact: true }).click();
  await expect(menu.getByText(name, { exact: true })).toBeVisible();
  items = await more(bob.page, name);
  await items.getByRole('menuitem', { name: 'Duplicate' }).click();
  await bob.page.getByRole('button', { name: 'Mine', exact: true }).click();
  await expect(menu.getByText(`Copy of ${name}`, { exact: true })).toBeVisible();

  // Alice edits her tab's preset and updates it, then deletes it.
  const renamed = `${idPrefix} Sign-ins of Alice`;
  menu = await searchNewMenu(page, idPrefix);
  await menu.getByText(name, { exact: true }).click();
  await page.getByRole('button', { name: 'Save…' }).click();
  dialog = page.getByRole('dialog', { name: 'Save preset' });
  await dialog.getByLabel('Name').fill(renamed);
  await dialog.getByRole('button', { name: `Update "${name}"` }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: renamed })).toBeVisible();

  menu = await searchNewMenu(page, idPrefix);
  await expect(menu.getByText(name, { exact: true })).toBeHidden();
  await (await more(page, renamed)).getByRole('menuitem', { name: 'Delete…' }).click();
  await page
    .getByRole('dialog', { name: `Delete "${renamed}"?` })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(menu.getByText(renamed, { exact: true })).toBeHidden();

  // Bob keeps only his copy.
  menu = await searchNewMenu(bob.page, idPrefix);
  await expect(menu.getByText(`Copy of ${name}`, { exact: true })).toBeVisible();
  await bob.page.getByRole('button', { name: 'Hidden', exact: true }).click();
  await expect(menu.getByText(name, { exact: true })).toBeHidden();
});

test("Save… on a preset's tab says when the presets can't be loaded, and retries", async ({
  page,
  idPrefix,
}) => {
  const name = `${idPrefix} Retry`;
  await openAction(page, ['Development', 'Rows', 'Sign-ins']);
  await page.getByRole('button', { name: 'Save…' }).click();
  await page
    .getByRole('dialog', { name: 'Save preset' })
    .getByLabel('Name', { exact: true })
    .fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();

  let failing = true;
  await page.route('**/api/presets', (route) =>
    failing && route.request().method() === 'GET'
      ? route.fulfill({ status: 503, body: 'down' })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Save…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save preset' });
  await expect(dialog.getByText(/Couldn't load your presets/)).toBeVisible();
  await expect(dialog.getByLabel('Name', { exact: true })).toBeHidden();

  failing = false;
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog.getByRole('button', { name: `Update "${name}"` })).toBeVisible();
});
