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

/** Distinct `mtk<N>` token classes currently rendered in the editor. */
export async function tokenClasses(page: Page, scope?: Locator): Promise<string[]> {
  const root = scope ?? page.locator('.monaco-editor').first();
  return root.locator('.view-lines span[class*="mtk"]').evaluateAll((els) => {
    const set = new Set<string>();
    for (const el of els) for (const c of el.classList) if (/^mtk\d+$/.test(c)) set.add(c);
    return [...set];
  });
}
