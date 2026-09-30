import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { shot } from '../shot';
import { templateStoreHandlers } from '../mocks/flows-b';

const store = templateStoreHandlers();
test.use({ apiOptions: { handlers: store.handlers } });
test.beforeEach(() => store.reset());

const dialogBody = (page: Page): Locator =>
  page.getByRole('dialog').locator('.MuiDialogContent-root');
const scrollToBottom = (page: Page) =>
  dialogBody(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

test('W12 hamburger menu opens the Query Manager list (screens 02, 33)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to TIM' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Query Manager' })).toBeVisible();
  await shot(page, '02-menu-hamburger');
  await page.getByRole('menuitem', { name: 'Query Manager' }).click();

  await expect(page.getByRole('heading', { name: 'Query Manager' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Delete (0)' })).toBeDisabled();
  for (const col of ['Name', 'Type', 'Menu text', 'Last Updated', 'Path', 'Cluster']) {
    await expect(page.getByRole('columnheader', { name: col })).toBeVisible();
  }
  const table = page.getByRole('table', { name: 'Query templates' });
  await expect(table.getByText('Storm events by state')).toBeVisible();
  await expect(table.getByText('Damage by event type')).toBeVisible();
  await expect(table.getByText('Recent storm triage view')).toBeVisible();
  await expect(table.getByText('Old deleted query')).toHaveCount(0);
  await expect(page.getByText(/1.3 of 3/)).toBeVisible();
  await shot(page, '33-query-manager');

  // Filter narrows the list.
  await page.getByLabel('Filter').fill('damage');
  await expect(table.getByText('Storm events by state')).toHaveCount(0);
  await expect(table.getByText('Damage by event type')).toBeVisible();
  await page.getByLabel('Filter').fill('');
});

test('W12 show deleted adds Restore and the greyed row (screen 34), restore works', async ({
  page,
  api,
}) => {
  await page.goto('/#/queries');
  await expect(page.getByRole('heading', { name: 'Query Manager' })).toBeVisible();
  await page.getByLabel('Show deleted').check();
  await expect(page.getByRole('button', { name: 'Restore (0)' })).toBeDisabled();
  await expect(page.getByText('Old deleted query')).toBeVisible();
  await expect(page.getByText('Archive')).toBeVisible();
  await expect(page.getByText(/1.4 of 4/)).toBeVisible();
  await shot(page, '34-query-manager-show-deleted');

  await page.getByRole('checkbox', { name: 'Select Old deleted query' }).check();
  await page.getByRole('button', { name: 'Restore (1)' }).click();
  await expect.poll(() => api.callsTo('PATCH', /\/api\/templates\/queries\//).length).toBe(1);
  expect(store.state.find((t) => t.name === 'Old deleted query')?.isDeleted).toBe(false);
  await expect(page.getByRole('button', { name: 'Restore (0)' })).toBeVisible();
});

test('W12 create dialog (screens 35, 36) validates required fields', async ({ page, api }) => {
  await page.goto('/#/queries');
  await page.getByRole('button', { name: 'Create' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Query' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Select type of query')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'View' })).toBeChecked();
  for (const l of [
    'Name',
    'Menu text',
    'Summary text',
    'Path',
    'Cluster',
    'Database',
    'Column Id',
  ]) {
    await expect(dialog.getByLabel(l).first()).toBeVisible();
  }
  await expect(dialog.getByText('Params')).toBeVisible();
  await shot(page, '35-create-query-dialog');

  await scrollToBottom(page);
  await expect(dialog.getByText('Column customisation')).toBeVisible();
  await expect(dialog.getByText('Query', { exact: true }).last()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create' })).toBeVisible();
  // Empty editors hold no text; wait until all three Monaco instances have rendered.
  await expect(dialog.locator('.monaco-editor .view-lines')).toHaveCount(3, { timeout: 30_000 });
  await expect(dialog.getByRole('progressbar')).toHaveCount(0);
  await page.waitForTimeout(300);
  await shot(page, '36-create-query-dialog-scrolled');

  // Required fields are validated; nothing is sent.
  await dialog.getByRole('button', { name: 'Create' }).click();
  expect(api.callsTo('POST', '/api/templates/queries')).toHaveLength(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('W12 edit dialog shows the stored query (screens 37, 38)', async ({ page }) => {
  await page.goto('/#/queries');
  await page.getByRole('button', { name: 'Storm events by state' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Query' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Name')).toHaveValue('Storm events by state');
  await expect(dialog.getByRole('radio', { name: 'Query' })).toBeChecked();
  await expect(dialog.getByLabel('Menu text')).toHaveValue('Storm events for state');
  await expect(dialog.getByLabel('Summary text')).toHaveValue('Storm events in {{State}}');
  await expect(dialog.getByText('Weather')).toBeVisible();
  await expect(dialog.getByText('Storms', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Cluster')).toHaveValue('https://help.kusto.windows.net');
  await expect(dialog.getByLabel('Database')).toHaveValue('Samples');
  await expect(dialog.getByLabel('Column Id')).toHaveValue('EventId');
  await shot(page, '37-edit-query-dialog');

  await scrollToBottom(page);
  await expect(dialog.getByText('Fields')).toBeVisible();
  await expect(dialog.getByText('Column customisation')).toBeVisible();
  await expect(dialog.locator('.monaco-editor').last()).toContainText('StormEvents');
  await shot(page, '38-edit-query-dialog-scrolled');
});

test('W12 managed query is read-only (screen 39)', async ({ page }) => {
  await page.goto('/#/queries');
  await page.getByRole('button', { name: 'Damage by event type' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Query' });
  await expect(dialog.getByText('This query is being managed by source control.')).toBeVisible();
  await expect(dialog.getByLabel('Name')).toBeDisabled();
  await expect(dialog.getByLabel('Menu text')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(dialog.getByText('Weather')).toBeVisible();
  await expect(dialog.getByText('Damage', { exact: true })).toBeVisible();
  await shot(page, '39-edit-query-dialog-managed');
});

test('W12 bulk delete removes the row, managed queries cannot be deleted', async ({
  page,
  api,
}) => {
  await page.goto('/#/queries');
  await page.getByRole('checkbox', { name: 'Select Damage by event type' }).check();
  await expect(page.getByRole('button', { name: 'Delete (1)' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Select Damage by event type' }).uncheck();

  await page.getByRole('checkbox', { name: 'Select Recent storm triage view' }).check();
  await page.getByRole('button', { name: 'Delete (1)' }).click();
  await expect.poll(() => api.callsTo('DELETE', /\/api\/templates\/queries\//).length).toBe(1);
  await expect(page.getByRole('button', { name: 'Recent storm triage view' })).toHaveCount(0);
});
