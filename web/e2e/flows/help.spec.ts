import { test, expect } from '../fixtures';
import { shot } from '../shot';
import { tokenClasses, waitForEditor } from '../mocks/editor';

test('help menu lists the wiki and bug report links', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to TIM' })).toBeVisible();
  await page.getByRole('button', { name: 'Help' }).click();
  const wiki = page.getByRole('menuitem', { name: 'Wiki Page' });
  const bug = page.getByRole('menuitem', { name: 'Report a bug' });
  await expect(wiki).toBeVisible();
  await expect(bug).toBeVisible();
  await expect(wiki).toHaveAttribute('href', /\/wiki$/);
  await expect(wiki).toHaveAttribute('target', '_blank');
  await expect(bug).toHaveAttribute('href', /\/issues$/);
  await shot(page, '03-menu-help');
});

test('Query Help dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /get started/i }).click();
  await page.getByRole('menuitem', { name: 'New query' }).click();
  await page.getByLabel('Cluster').first().click();
  await page.getByRole('option', { name: 'https://help.kusto.windows.net' }).first().click();
  await page.getByLabel('Database').first().click();
  await page.getByRole('option', { name: 'Samples' }).first().click();

  await waitForEditor(page);
  expect((await tokenClasses(page)).length).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Query Help' }).click();
  const dialog = page.getByRole('dialog', { name: 'Query Help' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Required Fields' })).toBeVisible();
  for (const f of ['EventId', 'EventTime', 'Cluster']) {
    await expect(dialog.getByText(f, { exact: true }).first()).toBeVisible();
  }
  await expect(dialog.getByRole('heading', { name: 'Time Range Parameters' })).toBeVisible();
  await expect(dialog.getByText('query_parameters').first()).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Tagged Events' })).toBeVisible();
  await expect(dialog.getByLabel('Time range sample').locator('strong')).toHaveText([
    'StartTime',
    'EndTime',
    'StartTime',
    'EndTime',
  ]);
  await shot(page, '13-query-help-dialog');

  await dialog.locator('.MuiDialogContent-root').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(dialog.getByRole('heading', { name: 'Examples' })).toBeVisible();
  await expect(dialog.getByText('More examples...')).toBeVisible();
  await expect(dialog.getByText('GetTagEvents', { exact: false }).first()).toBeVisible();
  await shot(page, '14-query-help-dialog-scrolled');

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});
