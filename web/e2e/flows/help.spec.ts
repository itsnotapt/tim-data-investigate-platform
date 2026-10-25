import { test, expect } from '../fixtures';
import { shot } from '../shot';

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
