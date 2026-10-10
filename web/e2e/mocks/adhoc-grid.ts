import { expect, type Locator, type Page } from '@playwright/test';

/**
 * A cell of the active tab's results grid. Visited tabs stay mounted but hidden (TabHost), so a
 * page-wide grid locator can also match a hidden tab's grid.
 */
export function gridCell(page: Page, rowIndex: number, colId: string): Locator {
  return page
    .getByTestId('results-grid')
    .filter({ visible: true })
    .locator(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]`);
}

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
  await expect(gridCell(page, 1, 'State')).toHaveText('KANSAS');
}

/** Right-click the State cell of the given row in the active tab's grid. */
export async function rightClickState(page: Page, rowIndex: number): Promise<void> {
  await gridCell(page, rowIndex, 'State').click({ button: 'right' });
}
