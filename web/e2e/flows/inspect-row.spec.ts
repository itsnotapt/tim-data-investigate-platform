import { test, expect } from '../realApi';
import { shot } from '../shot';
import { rightClickState, runJsonRows, STORM_ROWS } from '../stormRows';

test('Show details opens the Result Details panel', async ({ page }) => {
  await runJsonRows(page);
  await rightClickState(page, 0);
  await page.locator('.ag-menu-option', { hasText: 'Show details' }).click();

  const first = STORM_ROWS[0];
  const second = STORM_ROWS[1];
  const panel = page.getByLabel('Result details');
  await expect(panel).toContainText('Result Details');
  await expect(panel).toContainText('EventId');
  await expect(panel).toContainText(String(first?.['EventId']));
  await expect(panel).toContainText(String(first?.['State']));
  await expect(panel).toContainText(String(first?.['EventType']));
  await expect(panel).toContainText('TagEvent');
  await expect(panel).toContainText('investigate');
  await expect(panel).toContainText('Confirmed');
  await shot(page, '24-detail-side-panel');

  // The panel follows the focused cell.
  await page.locator('.ag-row[row-index="1"] .ag-cell[col-id="EventTime"]').click();
  await expect(panel).toContainText(String(second?.['EventId']));
  await expect(panel).toContainText(String(second?.['State']));
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(panel).toBeHidden();
});
