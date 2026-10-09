import { expect, type Page } from '@playwright/test';

/** Sign in (stub), New query, pick the sample cluster/database and run; waits for the grid. */
export async function runAdhocQuery(page: Page): Promise<void> {
  await page.goto('/');
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
}

/** Right-click the State cell of the given grid row. */
export async function rightClickState(page: Page, rowIndex: number): Promise<void> {
  await page
    .locator(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="State"]`)
    .click({ button: 'right' });
}
