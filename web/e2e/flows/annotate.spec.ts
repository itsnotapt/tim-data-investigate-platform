import type { Page } from '@playwright/test';
import { test, expect } from '../realApi';

const grid = (page: Page) => page.getByTestId('results-grid');
const dialog = (page: Page, name: 'Annotate' | 'Comment' = 'Annotate') =>
  page.getByRole('dialog', { name });

/** The grid rows whose Host is `host` (the part of each row beside the pinned selection column). */
const rowsWith = (page: Page, host: string) =>
  grid(page)
    .locator('.ag-row')
    .filter({ has: page.locator('.ag-cell[col-id="Host"]', { hasText: host }) });

/** Opens the development JSON action with `rows`, each row's id from `Host`, and runs it. */
async function runJson(page: Page, rows: Record<string, unknown>[]) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('button', { name: 'Development', exact: true }).click();
  await page.getByRole('button', { name: 'JSON (development)', exact: true }).click();
  await page.getByRole('button', { name: /^Rows: / }).click();
  await page.getByRole('textbox', { name: 'Rows' }).fill(JSON.stringify(rows));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Id column: / }).click();
  await page.getByRole('textbox', { name: 'Id column' }).fill('Host');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: `Results · ${rows.length}` })).toBeVisible();
}

/** Types `tags` into the open dialog's tag editor, each added with Enter. */
async function addTags(page: Page, ...tags: string[]) {
  const input = dialog(page).getByRole('combobox', { name: 'Add tag' });
  for (const tag of tags) {
    await input.fill(tag);
    await input.press('Enter');
    await expect(dialog(page).getByRole('button', { name: tag, exact: true })).toBeVisible();
  }
}

/** Annotates the row of `host` alone with `tags`. */
async function tagRow(page: Page, host: string, ...tags: string[]) {
  await grid(page).getByText(host).first().click();
  await page.keyboard.press('t');
  await addTags(page, ...tags);
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page)).toBeHidden();
}

test('a label, two tags and a comment saved at once reach every row with that id, and another analyst', async ({
  page,
  signIn,
  idPrefix,
}) => {
  const a = `${idPrefix}-a`;
  const b = `${idPrefix}-b`;
  await runJson(page, [{ Host: a }, { Host: b }, { Host: a }]);
  const teammate = await signIn(`${idPrefix}.teammate@example.com`);
  await runJson(teammate.page, [{ Host: a }]);

  await page.bringToFront();
  await grid(page).getByText(a).first().click();
  await page.keyboard.press('t');
  await expect(
    dialog(page).getByText('1 row · 1 id · also changes 1 other row with the same id'),
  ).toBeVisible();
  await expect(dialog(page).getByText('Now: no label')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Malicious' }).click();
  await addTags(page, 'beacon', 'c2');
  await dialog(page).getByRole('textbox', { name: 'Comment' }).fill('beacons every 60s');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Annotated 1 id')).toBeVisible();
  await expect(dialog(page)).toBeHidden();

  for (const row of await rowsWith(page, a).all()) {
    await expect(row).toHaveClass(/tim-label-red/);
    await expect(row.getByLabel('1 comment')).toBeVisible();
  }
  await expect(rowsWith(page, b).getByLabel(/comment/)).toHaveCount(0);

  await expect(rowsWith(teammate.page, a)).toHaveClass(/tim-label-red/);
  await expect(rowsWith(teammate.page, a).getByLabel('1 comment')).toBeVisible();
  await grid(teammate.page).getByText(a).click();
  await teammate.page.keyboard.press('t');
  await expect(dialog(teammate.page).getByText('Now: Malicious')).toBeVisible();
  for (const tag of ['beacon', 'c2']) {
    await expect(
      dialog(teammate.page).getByRole('button', { name: tag, exact: true }),
    ).toBeVisible();
  }
  await teammate.page.keyboard.press('Escape');

  await teammate.page.keyboard.press('c');
  await expect(dialog(teammate.page, 'Comment').getByRole('combobox')).toHaveCount(0);
  await dialog(teammate.page, 'Comment')
    .getByRole('textbox', { name: 'Comment' })
    .fill('owner confirmed');
  await teammate.page.keyboard.press('Control+Enter');
  await expect(teammate.page.getByText('Commented on 1 id')).toBeVisible();
  await expect(rowsWith(page, a).first().getByLabel('2 comments')).toBeVisible();
});

test('the Tags filter lists each tag once; a partial tag is removed from all, after an undo', async ({
  page,
  idPrefix,
}) => {
  const [a, b, c] = ['a', 'b', 'c'].map((s) => `${idPrefix}-${s}`) as [string, string, string];
  await runJson(page, [{ Host: a }, { Host: b }, { Host: c }]);
  await tagRow(page, a, 'beacon', 'c2');
  await tagRow(page, b, 'c2');

  await page.locator('.ag-side-button', { hasText: 'Filters' }).click();
  await page
    .locator('.ag-filter-toolpanel')
    .getByRole('button', { name: 'Tags', exact: true })
    .click();
  const items = page.locator('.ag-filter-toolpanel .ag-set-filter-item');
  await expect(items).toHaveText(['(Select All)', '(no tags)', 'beacon', 'c2']);
  await page.locator('.ag-side-button', { hasText: 'Filters' }).click();

  for (const host of [a, b]) {
    await rowsWith(page, host).locator('.ag-checkbox-input').check({ force: true });
  }
  await grid(page).getByText(a).click();
  await page.keyboard.press('t');
  const partial = dialog(page).getByRole('button', { name: 'beacon 1/2' });
  await expect(partial).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'c2', exact: true })).toBeVisible();
  await dialog(page).getByLabel('Remove beacon').click();
  const removed = dialog(page).getByRole('button', { name: 'beacon', exact: true });
  await expect(removed).toHaveCSS('text-decoration-line', 'line-through');
  await removed.click();
  await expect(partial).toBeVisible();
  await dialog(page).getByLabel('Remove beacon').click();
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Annotated 1 id')).toBeVisible();

  await grid(page).getByText(a).click();
  await page.keyboard.press('t');
  await expect(dialog(page).getByRole('button', { name: 'c2', exact: true })).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: /^beacon/ })).toHaveCount(0);
});
