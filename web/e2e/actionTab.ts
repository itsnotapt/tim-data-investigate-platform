import type { Page } from '@playwright/test';

/** Opens an action from the welcome page's New menu, through its menu path. */
export async function openAction(page: Page, path: string[]) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  for (const step of path) await page.getByRole('button', { name: step, exact: true }).click();
}

/** The results grid of the tab on show: tabs visited before stay mounted, hidden. */
export const grid = (page: Page) => page.getByTestId('results-grid').filter({ visible: true });
