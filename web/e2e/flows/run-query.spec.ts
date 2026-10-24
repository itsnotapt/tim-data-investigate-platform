import { test, expect } from '../fixtures';
import { shot } from '../shot';

test('sign in, new query, run shows the mocked rows', { tag: '@smoke' }, async ({ page, api }) => {
  await page.goto('/');

  // Stub auth signs in automatically (AuthGate renders the shell once the account resolves).
  await page.getByRole('button', { name: /get started/i }).click();
  await page.getByRole('menuitem', { name: 'New query' }).click();

  await page.getByLabel('Cluster').first().click();
  await page.getByRole('option', { name: 'https://help.kusto.windows.net' }).first().click();
  await page.getByLabel('Database').first().click();
  await page.getByRole('option', { name: 'Samples' }).first().click();

  await page.getByRole('button', { name: /save changes & run/i }).click();

  await expect(page.locator('.ag-row[row-index="1"] .ag-cell[col-id="State"]')).toHaveText(
    'KANSAS',
  );
  await expect(page.locator('.ag-row')).not.toHaveCount(0);
  await shot(page, '00-run-query-results');

  const [post] = api.callsTo('POST', '/api/kusto/query');
  expect(post?.authorization).toBe('Bearer dev:dev.user@example.com');
  expect(post?.body).toMatchObject({ database: 'Samples' });
});
