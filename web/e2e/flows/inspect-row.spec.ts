import type { Page } from '@playwright/test';
import { grid } from '../actionTab';
import { test, expect } from '../realApi';
import { shot } from '../shot';
import { rightClickState, runJsonRows, stateCell, STORM_ROWS } from '../stormRows';

const panel = (page: Page) => page.getByRole('complementary', { name: 'Row detail' });
const fields = (page: Page) => panel(page).getByRole('region', { name: 'Fields' });

test('Row detail shows the right-clicked row, then follows the focused row', async ({ page }) => {
  await runJsonRows(page);
  await rightClickState(page, 0);
  await page.locator('.ag-menu-option', { hasText: 'Row detail' }).click();

  const first = STORM_ROWS[0];
  const second = STORM_ROWS[1];
  await expect(panel(page).locator('code')).toHaveText(String(first?.['EventId']));
  await expect(fields(page).getByRole('term')).toHaveText([
    'EventTime',
    'EventId',
    'State',
    'EventType',
    'DamageProperty',
    'TagEvent',
  ]);
  await expect(fields(page)).toContainText(String(first?.['State']));
  await expect(fields(page)).toContainText(String(first?.['EventType']));
  await expect(fields(page)).toContainText('investigate');
  await expect(fields(page)).toContainText('Confirmed');
  await shot(page, '24-row-detail');

  // The arrow keys keep moving the grid's focus, and the panel follows it.
  await grid(page).locator('.ag-row[row-index="0"] .ag-cell[col-id="EventTime"]').click();
  await page.keyboard.press('ArrowDown');
  await expect(panel(page).locator('code')).toHaveText(String(second?.['EventId']));
  await expect(fields(page)).toContainText(String(second?.['State']));
  await expect(
    grid(page).locator('.ag-row[row-index="1"] .ag-cell-focus[col-id="EventTime"]'),
  ).toHaveCount(1);

  await page.keyboard.press('d');
  await expect(panel(page)).toBeHidden();
  // D opens it again, leaving keyboard focus in the grid.
  await page.keyboard.press('d');
  await page.keyboard.press('ArrowDown');
  await expect(panel(page).locator('code')).toHaveText(String(STORM_ROWS[2]?.['EventId']));
});

test('Row detail on a row without an id shows its fields and why it has no annotations', async ({
  page,
}) => {
  await runJsonRows(page, STORM_ROWS.slice(0, 3), 'NoSuchColumn');
  await stateCell(page, 0).click();
  await page.keyboard.press('d');

  await expect(panel(page)).toContainText(
    'No id: right-click a cell and use its column as the Id column',
  );
  await expect(fields(page)).toContainText(String(STORM_ROWS[0]?.['EventId']));
  await expect(panel(page).getByRole('textbox', { name: 'Comment' })).toBeHidden();
  await panel(page).getByRole('button', { name: 'Close row detail' }).click();
  await expect(panel(page)).toBeHidden();
});
