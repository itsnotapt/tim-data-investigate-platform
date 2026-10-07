import { test, expect } from '../fixtures';
import { rightClickState, runAdhocQuery, shotKeepMouse } from '../mocks/adhoc-grid';
import { shot } from '../shot';

test('context menu, pivot to a template child tab', async ({ page, api }) => {
  await runAdhocQuery(page);

  await rightClickState(page, 1);
  const menu = page.locator('.ag-menu');
  for (const item of [
    'Tag Events',
    'Show details',
    'Weather',
    'Copy',
    'Copy with Headers',
    'Export',
  ]) {
    await expect(menu.getByText(item, { exact: true })).toBeVisible();
  }
  await shot(page, '21-grid-context-menu');

  await menu.getByText('Weather', { exact: true }).hover();
  await page.locator('.ag-menu-option:has-text("Storms")').hover();
  await expect(page.locator('.ag-menu-option:has-text("Storm events for state")')).toBeVisible();
  await expect(page.locator('.ag-menu-option:has-text("Damage")')).toBeVisible();
  await shotKeepMouse(page, '23-grid-context-menu-pivot');

  await page.locator('.ag-menu-option:has-text("Storm events for state")').click();
  // The parent tab stays in view; the pivot child runs with State = KANSAS (clicked row).
  await expect.poll(() => api.callsTo('POST', '/api/kusto/query').length).toBe(2);
  const child = api.callsTo('POST', '/api/kusto/query')[1];
  expect(JSON.stringify(child?.body)).toContain("State == 'KANSAS'");
  await page.locator('.ag-row[row-index="2"] .ag-checkbox-input').first().check({ force: true });
  await page.locator('.ag-row[row-index="3"] .ag-checkbox-input').first().check({ force: true });
  await expect(page.locator('.ag-status-bar')).toContainText('Selected');
  await shot(page, '26-after-pivot');

  const tree = page.getByLabel('Query tree');
  await tree.hover();
  await expect(tree.getByText('New query')).toBeVisible();
  await expect(tree.getByText(/Storm events in KANSAS/)).toBeVisible();
  await shotKeepMouse(page, '27-side-tree-with-pivot');
});
