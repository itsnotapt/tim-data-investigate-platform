import { test, expect } from '../fixtures';
import { rightClickState, runAdhocQuery } from '../mocks/flows-a-helpers';
import { shot } from '../shot';

// W7: Inspect row (legacy screen 24)
test('W7: Show details opens the Result Details panel', async ({ page }) => {
  await runAdhocQuery(page);
  await rightClickState(page, 0);
  await page.locator('.ag-menu-option', { hasText: 'Show details' }).click();

  const panel = page.getByLabel('Result details');
  await expect(panel).toContainText('Result Details');
  await expect(panel).toContainText('EventId');
  await expect(panel).toContainText('61032');
  await expect(panel).toContainText('TEXAS');
  await expect(panel).toContainText('Hail');
  await expect(panel).toContainText('TagEvent');
  await expect(panel).toContainText('investigate');
  await expect(panel).toContainText('malicious');
  await expect(panel).toContainText('Confirmed');
  await shot(page, '24-detail-side-panel');

  // The panel follows the focused cell.
  await page.locator('.ag-row[row-index="1"] .ag-cell[col-id="EventTime"]').click();
  await expect(panel).toContainText('61039');
  await expect(panel).toContainText('KANSAS');
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(panel).toBeHidden();
});
