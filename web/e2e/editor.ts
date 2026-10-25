import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Waits until a Monaco editor has rendered text (not just the loading spinner). Pass `scope` to
 * target one editor; by default the first `.monaco-editor` on the page.
 */
export async function waitForEditor(page: Page, scope?: Locator): Promise<void> {
  const root = scope ?? page.locator('.monaco-editor').first();
  await expect(root.locator('.view-lines').first()).toContainText(/\S/, { timeout: 30_000 });
  // Tokenisation runs after first paint; give the coloured spans a moment.
  await page.waitForTimeout(300);
}
