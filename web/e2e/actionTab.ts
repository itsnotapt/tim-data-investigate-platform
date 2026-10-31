import { expect, type Page } from '@playwright/test';

/** Opens an action from the welcome page's New menu, through its menu path. */
export async function openAction(page: Page, path: string[]) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  for (const step of path) await page.getByRole('button', { name: step, exact: true }).click();
}

/** The results grid of the tab on show: tabs visited before stay mounted, hidden. */
export const grid = (page: Page) => page.getByTestId('results-grid').filter({ visible: true });

/** Sets the tab's Id column through its pill: typed, then Enter. */
export async function setIdColumn(page: Page, column: string) {
  await page.getByRole('button', { name: /^Id column: / }).click();
  await page.getByRole('combobox', { name: 'Id column' }).fill(column);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: `Id column: ${column}` })).toBeVisible();
}
