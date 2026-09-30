import { test, expect } from '../fixtures';
import { shot } from '../shot';
import { tokenClasses, waitForEditor } from '../mocks/editor';

// W2: Ad-hoc Kusto query (legacy screens 05, 07, 08, 09, 10, 11, 12, 15)
test('W2: new query, time range, cluster/database, run', async ({ page, api }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /get started/i }).click();
  await expect(page.getByText('New query').first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search queries' })).toBeVisible();
  await shot(page, '05-new-query-menu');

  await page.getByRole('menuitem', { name: 'New query' }).click();
  // New app shows the required-field errors only after a failed submit (legacy shows them at once).
  await expect(page.getByText('Cluster is required')).toHaveCount(0);
  await page.getByRole('button', { name: /save changes & run/i }).click();
  await expect(page.getByText('Cluster is required')).toBeVisible();
  await expect(page.getByText('Database is required')).toBeVisible();
  await expect(page.getByRole('button', { name: /time range: last 15 minutes/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /save changes & run/i })).toBeVisible();
  await waitForEditor(page);
  await shot(page, '07-kusto-query-edit');

  await page.getByRole('button', { name: /time range/i }).click();
  await expect(page.getByRole('menuitem', { name: 'Custom Date Range' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Last 7 days' })).toBeVisible();
  await waitForEditor(page);
  await shot(page, '08-time-range-menu');

  await page.getByRole('menuitem', { name: 'Custom Date Range' }).click();
  await expect(page.getByRole('dialog')).toContainText(/custom date range/i);
  await waitForEditor(page);
  await shot(page, '09-time-range-custom-date');
  await page.getByRole('button', { name: /cancel/i }).click();

  await page.getByRole('button', { name: /time range/i }).click();
  await page.getByRole('menuitem', { name: 'Custom Time Period' }).click();
  await expect(page.getByRole('dialog')).toContainText(/custom time period/i);
  await waitForEditor(page);
  await shot(page, '10-time-range-custom-period');
  await page.getByRole('button', { name: /cancel/i }).click();

  await page.getByLabel('Cluster').first().click();
  await expect(
    page.getByRole('option', { name: 'https://help.kusto.windows.net' }).first(),
  ).toBeVisible();
  await waitForEditor(page);
  await shot(page, '11-cluster-selection');
  await page.getByRole('option', { name: 'https://help.kusto.windows.net' }).first().click();
  await page.getByLabel('Database').first().click();
  await page.getByRole('option', { name: 'Samples' }).first().click();
  await expect(page.getByText('Cluster is required')).toHaveCount(0);
  await expect(page.getByText('Database is required')).toHaveCount(0);
  await waitForEditor(page);
  expect((await tokenClasses(page)).length).toBeGreaterThan(1);
  await shot(page, '12-kusto-query-edit-filled');

  await page.getByRole('button', { name: /save changes & run/i }).click();
  await expect(page.locator('.ag-row[row-index="1"] .ag-cell[col-id="State"]')).toHaveText(
    'KANSAS',
  );
  await expect(page.locator('.ag-status-bar')).toContainText('40');
  await expect(page.locator('.ag-status-bar')).toContainText('Execution Time');
  await shot(page, '15-kusto-query-results');
  expect(api.callsTo('POST', '/api/kusto/query')).toHaveLength(1);
});
