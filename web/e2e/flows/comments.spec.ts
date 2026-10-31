import type { Page } from '@playwright/test';
import { grid, openAction, setIdColumn } from '../actionTab';
import { test, expect } from '../realApi';

const panel = (page: Page) => page.getByRole('complementary', { name: 'Row detail' });
const entries = (page: Page) => panel(page).getByRole('list', { name: 'History' }).locator('li');

/** The grid rows whose Host is `host` (the part of each row beside the pinned selection column). */
const rowsWith = (page: Page, host: string) =>
  grid(page)
    .locator('.ag-row')
    .filter({ has: page.locator('.ag-cell[col-id="Host"]', { hasText: host }) });

/** The Comment cell of the rows of `host`. */
const commentOf = (page: Page, host: string) =>
  rowsWith(page, host).locator('.ag-cell[col-id="tim:comments"]');

/** Opens the development JSON action with `rows`, each row's id from `Host`, and runs it. */
async function runJson(page: Page, rows: Record<string, unknown>[]) {
  await openAction(page, ['Development', 'JSON (development)']);
  await page.getByRole('button', { name: /^Rows: / }).click();
  await page.getByRole('textbox', { name: 'Rows' }).fill(JSON.stringify(rows));
  await page.keyboard.press('Escape');
  await setIdColumn(page, 'Host');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: `Results · ${rows.length}` })).toBeVisible();
}

/** Double-clicks the first Comment cell of `host`, replaces its text with `text`, and saves. */
async function commentInCell(page: Page, host: string, text: string) {
  await commentOf(page, host).first().dblclick();
  const editor = page.getByRole('textbox', { name: `Your comment on ${host}` });
  await editor.fill(text);
  await editor.press('Enter');
  await expect(editor).toBeHidden();
}

test('a comment edited in the grid reaches every row of its id and a teammate, is in History as last saved, and when cleared shows the teammate’s', async ({
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
  await commentOf(page, a).first().dblclick();
  const editor = page.getByRole('textbox', { name: `Your comment on ${a}` });
  // Letters that are grid keys elsewhere (T, C, D, 1) are the comment's text here.
  await editor.pressSequentially('tcd 1 beacons');
  await expect(page.getByRole('dialog', { name: /^(Annotate|Comment)$/ })).toBeHidden();
  await expect(panel(page)).toBeHidden();
  await editor.press('Shift+Enter');
  await editor.pressSequentially('every 60s');
  await editor.press('Enter');
  await expect(editor).toBeHidden();
  await expect(commentOf(page, a)).toHaveText([
    'tcd 1 beacons ⏎ every 60s',
    'tcd 1 beacons ⏎ every 60s',
  ]);
  await expect(commentOf(page, b)).toHaveText('');
  await expect(rowsWith(page, a).first()).not.toHaveClass(/tim-label-/);

  await expect(commentOf(teammate.page, a)).toHaveText(
    `${idPrefix}.analyst: tcd 1 beacons ⏎ every 60s`,
  );
  await commentInCell(teammate.page, a, 'owner confirmed');
  await expect(commentOf(teammate.page, a)).toHaveText('owner confirmed+1');

  await page.bringToFront();
  await expect(commentOf(page, a).first()).toHaveText('tcd 1 beacons ⏎ every 60s+1');
  await rowsWith(page, a).locator('.ag-cell[col-id="Host"]').first().click();
  await page.keyboard.press('d');
  const box = panel(page).getByRole('textbox', { name: 'Comment' });
  await expect(box).toHaveValue('tcd 1 beacons\nevery 60s');
  await box.fill('beacons every 30s');
  await panel(page).getByRole('button', { name: 'Save' }).click();
  const teammates = new RegExp(`^${idPrefix}\\.teammate@example\\.com · .*owner confirmed$`);
  await expect(entries(page)).toHaveText([/beacons every 30s$/, teammates]);
  await expect(commentOf(page, a).first()).toHaveText('beacons every 30s+1');

  await commentInCell(page, a, '');
  await expect(commentOf(page, a)).toHaveText([
    `${idPrefix}.teammate: owner confirmed`,
    `${idPrefix}.teammate: owner confirmed`,
  ]);
  await expect(entries(page)).toHaveText([teammates]);
  await expect(box).toHaveValue('');
});
