import { test, expect } from '../realApi';

test('an action pressed while its folder opens stays under the pointer, and opens', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByRole('button', { name: 'Actions and presets' }).click();
  await page.getByRole('button', { name: 'Development', exact: true }).click();

  // The last item of Development, pressed at once: below what the opening folder shows so far.
  await page.getByRole('button', { name: 'JSON (development)', exact: true }).hover();
  await page.mouse.down();
  await page.waitForTimeout(500); // longer than the folder takes to open
  await page.mouse.up();

  await expect(page).toHaveURL(/\/view\//);
  await expect(page.getByRole('heading', { name: 'JSON (development)' })).toBeVisible();
});
