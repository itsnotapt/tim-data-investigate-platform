import type { Page } from '@playwright/test';
import { test, expect } from '../realApi';

/** Ctrl+Space in the focused editor, then the suggestions Monaco shows. */
async function suggest(page: Page) {
  await page.keyboard.press('Control+Space');
  return page.getByRole('listbox', { name: 'Suggest' });
}

test('the Query editor completes the tables and columns of the chosen connection and database', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  for (const step of ['Development', 'Editor', 'KQL editor']) {
    await page.getByRole('button', { name: step, exact: true }).click();
  }

  await page.getByRole('button', { name: 'Connection: not set' }).click();
  await page.getByRole('option', { name: 'Development audit' }).click();
  await page.getByRole('button', { name: 'Database: not set' }).click();
  const loaded = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/connections/dev-audit/schema' && r.ok(),
  );
  await page.getByRole('textbox', { name: 'Database' }).fill('Logs');
  await page.keyboard.press('Escape');
  expect((await loaded).status()).toBe(200);

  // Monaco's input is an invisible element over the text, so it is focused rather than clicked.
  await page.getByRole('textbox', { name: 'Query' }).focus();
  // The worker takes the schema a moment after the response.
  await expect(async () => {
    await page.keyboard.press('Escape');
    const suggestions = await suggest(page);
    await expect(suggestions.getByRole('listitem', { name: 'SignIns, Class' })).toBeVisible({
      timeout: 1000,
    });
  }).toPass();

  await page.keyboard.press('Escape');
  await page.keyboard.type('SignIns | where UserP');
  const suggestions = await suggest(page);
  await expect(suggestions.getByRole('listitem', { name: /^UserPrincipalName, / })).toBeVisible();
});
