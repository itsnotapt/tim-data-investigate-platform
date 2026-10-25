import type { Page } from '@playwright/test';
import { grid, openAction } from './actionTab';
import { expect } from './realApi';

const STATES = ['TEXAS', 'KANSAS', 'IOWA', 'FLORIDA', 'OHIO', 'GEORGIA'];
const TYPES = ['Hail', 'Thunderstorm Wind', 'Flash Flood', 'Tornado', 'Heavy Rain'];
const NOW = Date.parse('2026-09-29T10:00:00Z');

/** Rows with a State, an EventId, an EventTime and a nested TagEvent object, for the grid flows. */
export const STORM_ROWS: Record<string, unknown>[] = Array.from({ length: 24 }, (_, i) => ({
  EventTime: new Date(NOW - i * 97 * 60000).toISOString(),
  EventId: String(61032 + i * 7),
  State: STATES[i % STATES.length],
  EventType: TYPES[i % TYPES.length],
  DamageProperty: (i * 1375) % 20000,
  TagEvent: i % 5 === 0 ? { Tags: ['investigate'], Comment: 'Confirmed' } : null,
}));

/** The State cell of the given row in the grid on show. */
export const stateCell = (page: Page, rowIndex: number) =>
  grid(page).locator(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="State"]`);

/** Right-clicks the State cell of the given row. */
export const rightClickState = (page: Page, rowIndex: number) =>
  stateCell(page, rowIndex).click({ button: 'right' });

/**
 * Opens the development JSON action with `rows`, their id from `idColumn`, and runs it; waits for
 * the grid to show the first row.
 */
export async function runJsonRows(
  page: Page,
  rows: Record<string, unknown>[] = STORM_ROWS,
  idColumn = 'EventId',
) {
  await openAction(page, ['Development', 'JSON (development)']);
  await page.getByRole('button', { name: /^Rows: / }).click();
  await page.getByRole('textbox', { name: 'Rows' }).fill(JSON.stringify(rows));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Id column: / }).click();
  await page.getByRole('textbox', { name: 'Id column' }).fill(idColumn);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: `Results · ${rows.length}` })).toBeVisible();
  await expect(stateCell(page, 0)).toHaveText(String(rows[0]?.['State']));
}
