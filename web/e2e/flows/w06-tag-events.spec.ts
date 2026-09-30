import { test, expect } from '../fixtures';
import { rightClickState, runAdhocQuery, shotKeepMouse } from '../mocks/flows-a-helpers';
import { shot } from '../shot';

// W6: Tag events (legacy screens 22, 25)
test('W6: quick tag submenu, then the customise dialog', async ({ page, api }) => {
  await runAdhocQuery(page);

  await rightClickState(page, 1);
  await page.locator('.ag-menu-option:has-text("Tag Events")').hover();
  for (const item of [
    'Customise tag events',
    'Quick - Malicious',
    'Quick - Suspicious',
    'Quick - Benign',
  ]) {
    await expect(page.locator('.ag-menu-option', { hasText: item })).toBeVisible();
  }
  await shotKeepMouse(page, '22-grid-context-menu-tag');

  // Quick tag the clicked (unsaved) row: saved-events then comments are posted.
  await page.locator('.ag-menu-option', { hasText: 'Quick - Malicious' }).click();
  await expect
    .poll(() => api.callsTo('POST', /\/api\/taggedevents\//).map((c) => c.path))
    .toEqual(
      expect.arrayContaining(['/api/taggedevents/savedEvents', '/api/taggedevents/comments']),
    );

  // Select two rows and open the detailed dialog.
  await page.locator('.ag-row[row-index="2"] .ag-checkbox-input').first().check({ force: true });
  await page.locator('.ag-row[row-index="3"] .ag-checkbox-input').first().check({ force: true });
  await rightClickState(page, 2);
  await page.locator('.ag-menu-option:has-text("Tag Events")').hover();
  await page.locator('.ag-menu-option', { hasText: 'Customise tag events' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Customise Tag Events');
  await expect(dialog).toContainText('2 event(s) selected');
  await expect(dialog.getByLabel('Determination', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Comment', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Tags', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /close/i })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^save$/i })).toBeVisible();
  await shot(page, '25-tag-event-dialog');
});
