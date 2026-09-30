import { test, expect } from '../fixtures';
import { rightClickState, runAdhocQuery } from '../mocks/flows-a-helpers';
import { shot } from '../shot';

// W5: Open a template directly (legacy screens 06, 28, 29, 31, 32)
test('W5: search the New query menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /get started/i }).click();
  await page.getByRole('textbox', { name: 'Search queries' }).fill('storm');
  await expect(
    page.getByRole('menu').getByRole('button', { name: 'Recent storms', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('menu').getByRole('button', { name: 'Storm events for state', exact: true }),
  ).toBeVisible();
  await shot(page, '06-new-query-menu-search');
});

test('W5: template results, edit mode, template tree, new draft', async ({ page }) => {
  await runAdhocQuery(page);
  await rightClickState(page, 0);
  await page.locator('.ag-menu').getByText('Weather', { exact: true }).hover();
  await page.locator('.ag-menu-option:has-text("Storms")').hover();
  await page.locator('.ag-menu-option:has-text("Storm events for state")').click();

  // Open the child tab from the tree: results with the template toolbar.
  const tree = page.getByLabel('Query tree');
  await tree.hover();
  await tree.getByText(/Storm events in TEXAS/).click();
  await page.mouse.move(900, 500);
  await expect(page.getByRole('button', { name: /^convert$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /share link/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^edit$/i })).toBeVisible();
  await expect(page.locator('.ag-row[row-index="1"] .ag-cell[col-id="State"]')).toHaveText(
    'KANSAS',
  );
  await shot(page, '28-template-query-results');

  await page.getByRole('button', { name: /^edit$/i }).click();
  await expect(page.getByRole('textbox', { name: 'Summary' })).toHaveValue('Storm events in TEXAS');
  await expect(page.getByRole('textbox', { name: 'State' })).toHaveValue('TEXAS');
  await expect(page.getByText('Preview Query')).toBeVisible();
  await expect(page.getByRole('button', { name: /save & run/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^save$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
  await shot(page, '29-template-query-edit');
  await page.getByRole('button', { name: /cancel/i }).click();

  // NEW menu shows the template tree; pick Damage for event type.
  await page.getByRole('button', { name: /^new$/i }).first().click();
  await page.getByRole('menu').getByRole('button', { name: 'Queries', exact: true }).click();
  await page.getByRole('menu').getByRole('button', { name: 'Weather', exact: true }).click();
  await expect(
    page.getByRole('menu').getByRole('button', { name: 'Storms', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('menu').getByRole('button', { name: 'Damage', exact: true }),
  ).toBeVisible();
  await shot(page, '31-new-menu-template-tree');

  await page.getByRole('menu').getByRole('button', { name: 'Damage', exact: true }).click();
  await page
    .getByRole('menu')
    .getByRole('button', { name: 'Damage for event type', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'Summary' })).toHaveValue(
    'Damage summary for {{EventType}}',
  );
  await expect(page.getByRole('textbox', { name: 'EventType' })).toHaveValue('');
  await expect(page.getByRole('button', { name: /run query/i })).toBeDisabled();
  await expect(page.getByRole('button', { name: /convert/i })).toBeDisabled();
  await shot(page, '32-template-new-draft');
});
