import type { Page } from '@playwright/test';
import { openAction } from '../actionTab';
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

/**
 * Declares a query parameter `name` of `type`, read from the clicked row, in Save…, which saves the
 * tab as a preset and gives it the query parameter's pill.
 */
async function addQueryParameter(page: Page, preset: string, name: string, type: string) {
  await page.getByRole('button', { name: 'Save…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save preset' });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(preset);
  await dialog.getByRole('button', { name: 'Add query parameter' }).click();
  const parameter = dialog.getByRole('group', { name: 'Query parameter 1' });
  await parameter.getByRole('combobox', { name: 'Name' }).fill(name);
  await parameter.getByRole('combobox', { name: 'Type' }).selectOption(type);
  await parameter.getByRole('button', { name: 'From row' }).click();
  await expect(dialog.getByText(`declare query_parameters(${name}:${type});`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Removes the only query parameter in Save…, updating the tab's preset. */
async function removeQueryParameter(page: Page, preset: string) {
  await page.getByRole('button', { name: 'Save…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save preset' });
  await dialog
    .getByRole('group', { name: 'Query parameter 1' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await dialog.getByRole('button', { name: `Update "${preset}"` }).click();
  await expect(dialog).toBeHidden();
}

async function pickConnection(page: Page) {
  await page.getByRole('button', { name: 'Connection: not set' }).click();
  await page.getByRole('option', { name: 'Development audit' }).click();
}

/** Sets the database, and waits for its schema. */
async function pickDatabase(page: Page) {
  await page.getByRole('button', { name: 'Database: not set' }).click();
  const loaded = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/connections/dev-audit/schema' && r.ok(),
  );
  await page.getByRole('textbox', { name: 'Database' }).fill('Logs');
  await page.keyboard.press('Escape');
  await loaded;
}

/** Retries Ctrl+Space until each of `items` is suggested: the worker takes changes a moment later. */
async function expectSuggested(page: Page, items: RegExp[]) {
  await expect(async () => {
    await page.keyboard.press('Escape');
    const suggestions = await suggest(page);
    for (const item of items) {
      await expect(suggestions.getByRole('listitem', { name: item })).toBeVisible({
        timeout: 1000,
      });
    }
  }).toPass();
}

test('a query parameter is declared above the query, and the editor suggests it', async ({
  page,
  idPrefix,
}) => {
  const preset = `${idPrefix} Since`;
  await openAction(page, ['Development', 'Run KQL (development)']);
  await pickConnection(page);
  await pickDatabase(page);
  const editor = page.getByRole('group', { name: 'Query' });
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await expect(editor.getByText(/^declare/)).toHaveCount(0);

  await addQueryParameter(page, preset, 'since', 'datetime');
  const declare = editor.getByText('declare query_parameters(since:datetime);');
  await expect(declare).toBeVisible();
  // The line isn't the query's: the query's first line is line 1.
  await expect(editor.locator('.line-numbers').first()).toHaveText('1');

  // A scalar is suggested where a scalar goes, not where the query starts.
  await page.getByRole('textbox', { name: 'Query' }).focus();
  await page.keyboard.type('print sin');
  await expectSuggested(page, [/^since, /]);
  await page.keyboard.press('Escape');

  await removeQueryParameter(page, preset);
  await expect(declare).toBeHidden();
});

test('a schema that loads after a query parameter is added keeps it suggested', async ({
  page,
  idPrefix,
}) => {
  await openAction(page, ['Development', 'Run KQL (development)']);
  await pickConnection(page);
  await addQueryParameter(page, `${idPrefix} Since`, 'since', 'datetime');
  await pickDatabase(page);

  await page.getByRole('textbox', { name: 'Query' }).focus();
  await expectSuggested(page, [/^SignIns, /]);
  await page.keyboard.press('Escape');
  await page.keyboard.type('print sin');
  await expectSuggested(page, [/^since, /]);
});
