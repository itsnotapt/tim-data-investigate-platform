import { test, expect } from '../fixtures';
import { shot } from '../shot';
import { openRunTemplateTab, shareParams, STORM_UUID } from '../mocks/flows-b';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('W8 share link with missing parameters shows an error (screen 00)', async ({ page }) => {
  await page.goto(`/#/share/${STORM_UUID}`);
  await expect(page.getByText('Parameters are missing.')).toBeVisible();
  await shot(page, '00-share-missing-params');
});

test('W8 unknown template and garbage params show errors', async ({ page }) => {
  await page.goto(`/#/share/99999999-9999-9999-9999-999999999999?p=${shareParams({})}`);
  await expect(page.getByText('This query was not found.')).toBeVisible();
  await page.goto(`/#/share/${STORM_UUID}?p=%25%25%25`);
  await expect(page.getByText('Parameters are invalid.')).toBeVisible();
});

test('W8 Share Link copies an execute=0 link that recreates the tab without running', async ({
  page,
  api,
}) => {
  await openRunTemplateTab(page);
  await page.getByRole('button', { name: 'Share Link' }).click();
  await expect(page.getByText('Shared link has been saved to the clipboard.')).toBeVisible();

  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain(`#/share/${STORM_UUID}?p=`);
  expect(link).toContain('execute=0');

  const runsBefore = api.callsTo('POST', '/api/kusto/query').length;
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  // execute=0: opens in edit mode, nothing runs,.
  await expect(page.getByRole('button', { name: 'Save & Run' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'State' })).toHaveValue('TEXAS');
  expect(api.callsTo('POST', '/api/kusto/query')).toHaveLength(runsBefore);
});

test('W8 execute=1 link runs immediately and opens results (screen 41, Q-110 reverted)', async ({
  page,
  api,
}) => {
  await page.goto(`/#/share/${STORM_UUID}?p=${shareParams({ State: 'TEXAS' })}&execute=1`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.ag-row[row-index="1"] .ag-cell[col-id="State"]')).toHaveText(
    'KANSAS',
  );
  await expect(page.getByRole('button', { name: 'Share Link' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Convert' })).toBeVisible();
  await expect(page.locator('.ag-status-bar')).toContainText(/Total Rows\s*:?\s*40/);
  expect(api.callsTo('POST', '/api/kusto/query')).toHaveLength(1);
  await shot(page, '41-share-link-opened');
});
