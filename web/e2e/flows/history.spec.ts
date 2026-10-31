import type { Page } from '@playwright/test';
import { grid, openAction } from '../actionTab';
import { test, expect } from '../realApi';

const panel = (page: Page) => page.getByRole('complementary', { name: 'Row detail' });
const entries = (page: Page) => panel(page).getByRole('list', { name: 'History' }).locator('li');

/** The grid rows whose Host is `host` (the part of each row beside the pinned selection column). */
const rowsWith = (page: Page, host: string) =>
  grid(page)
    .locator('.ag-row')
    .filter({ has: page.locator('.ag-cell[col-id="Host"]', { hasText: host }) });

/** Opens the development JSON action with `rows`, each row's id from `Host`, and runs it. */
async function runJson(page: Page, rows: Record<string, unknown>[]) {
  await openAction(page, ['Development', 'JSON (development)']);
  await page.getByRole('button', { name: /^Rows: / }).click();
  await page.getByRole('textbox', { name: 'Rows' }).fill(JSON.stringify(rows));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Id column: / }).click();
  await page.getByRole('textbox', { name: 'Id column' }).fill('Host');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: `Results · ${rows.length}` })).toBeVisible();
}

/** Clicks the Host cell of the row of `host`, focusing it. */
const focusRow = (page: Page, host: string) =>
  rowsWith(page, host).locator('.ag-cell[col-id="Host"]').first().click();

test('D opens Row detail on the focused row, which follows focus and a teammate’s comment', async ({
  page,
  signIn,
  idPrefix,
}) => {
  // An id with characters the query string has to encode.
  const a = `${idPrefix} a&id=b #1 %20+é`;
  const b = `${idPrefix}-b`;
  const me = `${idPrefix}.analyst@example.com`;
  await runJson(page, [{ Host: a, Bytes: 2048 }, { Host: b }]);

  await focusRow(page, a);
  await page.keyboard.press('d');
  await expect(panel(page).locator('code')).toHaveText(a);
  // Keyboard focus stays in the grid, so the label keys act on the row shown.
  await page.keyboard.press('1');
  await expect(rowsWith(page, a)).toHaveClass(/tim-label-red/);
  await expect(panel(page).getByText('Malicious', { exact: true })).toBeVisible();
  await page.keyboard.press('3');
  await expect(rowsWith(page, a)).toHaveClass(/tim-label-green/);

  await expect(panel(page).getByText('Benign', { exact: true })).toBeVisible();
  await expect(entries(page)).toHaveText([
    new RegExp(`^Malicious → Benign · ${me} · `),
    new RegExp(`^No label → Malicious · ${me} · `),
  ]);
  await expect(panel(page).getByRole('region', { name: 'Fields' })).toContainText('2048');

  const comment = panel(page).getByRole('textbox', { name: 'Comment' });
  const save = panel(page).getByRole('button', { name: 'Save' });
  await comment.fill('first look');
  await save.click();
  await expect(entries(page).first()).toHaveText(/first look$/);
  await expect(comment).toHaveValue('first look');
  await comment.fill('beacons every 60s');
  await save.click();
  await expect(entries(page)).toHaveText([
    /beacons every 60s$/,
    /^Malicious → Benign/,
    /^No label → Malicious/,
  ]);
  await expect(rowsWith(page, a).locator('.ag-cell[col-id="tim:comments"]')).toHaveText(
    'beacons every 60s',
  );

  const teammate = await signIn(`${idPrefix}.teammate@example.com`);
  await runJson(teammate.page, [{ Host: a }]);
  await focusRow(teammate.page, a);
  await teammate.page.keyboard.press('c');
  await teammate.page
    .getByRole('dialog', { name: 'Comment' })
    .getByRole('textbox', { name: 'Comment' })
    .fill('owner confirmed');
  await teammate.page
    .getByRole('dialog', { name: 'Comment' })
    .getByRole('button', { name: 'Save' })
    .click();
  await expect(teammate.page.getByText('Commented on 1 id')).toBeVisible();

  await page.bringToFront();
  const teammates = new RegExp(`^${idPrefix}\\.teammate@example\\.com · .*owner confirmed$`);
  await expect(entries(page).first()).toHaveText(teammates);
  await panel(page).getByRole('button', { name: 'Delete comment' }).click();
  await expect(entries(page)).toHaveText([
    teammates,
    /^Malicious → Benign/,
    /^No label → Malicious/,
  ]);
  await expect(comment).toHaveValue('');
  await expect(rowsWith(page, a).locator('.ag-cell[col-id="tim:comments"]')).toHaveText(
    `${idPrefix}.teammate: owner confirmed`,
  );

  await focusRow(page, b);
  await expect(panel(page).locator('code')).toHaveText(b);
  await expect(panel(page).getByText('No label', { exact: true })).toBeVisible();
  await expect(entries(page)).toHaveCount(0);

  const fold = panel(page).getByRole('button', { name: /^Comments and history/ });
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await focusRow(page, a);
  await expect(panel(page).locator('code')).toHaveText(a);
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(entries(page)).toHaveCount(0);
  await fold.click();
  await expect(entries(page)).toHaveCount(3);
  await panel(page).getByRole('button', { name: 'Close row detail' }).click();
  await expect(panel(page)).toBeHidden();
});

const menuOption = (page: Page, text: string) => page.locator('.ag-menu-option', { hasText: text });

test('Row detail is on the right-click menu, and says why a row without an id has no annotations', async ({
  page,
  idPrefix,
}) => {
  const a = `${idPrefix}-a`;
  const none = `${idPrefix}-none`;
  await runJson(page, [{ Host: a }, { Other: none }]);
  await rowsWith(page, a).locator('.ag-cell[col-id="Host"]').click({ button: 'right' });
  await menuOption(page, 'Row detail').click();
  await expect(panel(page).locator('code')).toHaveText(a);
  await expect(entries(page)).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Close row detail' }).click();

  await grid(page).getByText(none).click({ button: 'right' });
  await expect(menuOption(page, 'Row detail')).not.toHaveAttribute('aria-disabled', 'true');
  await menuOption(page, 'Row detail').click();
  await expect(panel(page)).toContainText(
    'No id: right-click a cell and use its column as the Id column',
  );
  await expect(panel(page).getByRole('region', { name: 'Fields' })).toContainText(none);
  await expect(panel(page).getByRole('textbox', { name: 'Comment' })).toBeHidden();
  await grid(page).getByText(none).click();
  await page.keyboard.press('d');
  await expect(panel(page)).toBeHidden();
  await page.keyboard.press('h');
  await expect(panel(page)).toBeHidden();
});
