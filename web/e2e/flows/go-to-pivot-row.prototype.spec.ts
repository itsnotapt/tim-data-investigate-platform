/** PROTOTYPE — throwaway. Screenshots each Go to pivot row variant into e2e/.screenshots/. */
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { grid, openAction } from '../actionTab';
import { test, expect } from '../realApi';
import { SHOT_DIR } from '../shot';

const row = (page: Page, index: number) => grid(page).locator(`.ag-row[row-index="${index}"]`);
const menuOption = (page: Page, name: string) =>
  page.locator('.ag-menu-option').filter({ hasText: new RegExp(`^${name}$`) });

test('PROTOTYPE: screenshot Go to pivot row variants', async ({ page }) => {
  await openAction(page, ['Development', 'Rows', 'Generated rows']);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: 'Results · 2500' })).toBeVisible();

  await row(page, 0).locator('[col-id="Host"]').click({ button: 'right' });
  for (const step of ['Pivot', 'Development', 'Pivots']) await menuOption(page, step).hover();
  await menuOption(page, 'Host list').click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Running Host list' })
    .getByRole('button', { name: 'Go to' })
    .click();
  await expect(page.getByRole('tab', { name: 'Results · 2500' })).toBeVisible();
  await page.mouse.move(0, 0);
  const base = page.url();
  for (const v of ['current', 'A', 'B', 'C']) {
    const url = new URL(base);
    url.searchParams.set('variant', v);
    await page.evaluate((u) => {
      window.history.replaceState(window.history.state, '', u);
      window.dispatchEvent(new Event('prototype-variant-change'));
    }, url.toString());
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(SHOT_DIR, `pivot-${v}.png`) });
    const go =
      v === 'B'
        ? page.getByRole('button', { name: /^Go to pivot row/ })
        : page.getByRole('button', { name: /pivot row/i }).first();
    await go.click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(SHOT_DIR, `pivot-${v}-clicked.png`) });
    if (v === 'B') {
      await page.getByRole('button', { name: /^Go to pivot row/ }).hover();
      await page.waitForTimeout(400);
      await page.screenshot({ path: resolve(SHOT_DIR, `pivot-${v}-hover.png`) });
    }
  }
});

test('PROTOTYPE: C2 counts and switches Go to / Highlight', async ({ page }) => {
  await openAction(page, ['Development', 'Rows', 'Generated rows']);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: 'Results · 2500' })).toBeVisible();
  for (const i of [0, 1, 9, 19])
    await row(page, i).locator('.ag-checkbox-input').first().check({ force: true });
  await row(page, 0).locator('[col-id="Host"]').click({ button: 'right' });
  for (const step of ['Pivot', 'Development', 'Pivots']) await menuOption(page, step).hover();
  await page.locator('.ag-menu-option').filter({ hasText: 'Host list (many)' }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Running Host list' })
    .getByRole('button', { name: 'Go to' })
    .click();
  await expect(page.getByRole('tab', { name: 'Results · 2500' })).toBeVisible();
  const url = new URL(page.url());
  url.searchParams.set('variant', 'C2');
  await page.evaluate((u) => {
    window.history.replaceState(window.history.state, '', u);
    window.dispatchEvent(new Event('prototype-variant-change'));
  }, url.toString());
  const link = page.locator('.ag-status-bar-center button');
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(400);
    console.log(`before click ${i + 1}: ${await link.innerText()}`);
    await page.screenshot({ path: resolve(SHOT_DIR, `pivot-C2-${i}.png`) });
    await link.click();
  }
});

test('PROTOTYPE: C3 Go to + Highlight pivot rows checkbox', async ({ page }) => {
  await openAction(page, ['Development', 'Rows', 'Generated rows']);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: 'Results · 2500' })).toBeVisible();
  for (const i of [0, 1, 9, 19])
    await row(page, i).locator('.ag-checkbox-input').first().check({ force: true });
  await row(page, 0).locator('[col-id="Host"]').click({ button: 'right' });
  for (const step of ['Pivot', 'Development', 'Pivots']) await menuOption(page, step).hover();
  await page.locator('.ag-menu-option').filter({ hasText: 'Host list (many)' }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Running Host list' })
    .getByRole('button', { name: 'Go to' })
    .click();
  await expect(page.getByRole('tab', { name: 'Results · 2500' })).toBeVisible();
  const url = new URL(page.url());
  url.searchParams.set('variant', 'C3');
  await page.evaluate((u) => {
    window.history.replaceState(window.history.state, '', u);
    window.dispatchEvent(new Event('prototype-variant-change'));
  }, url.toString());
  await page.waitForTimeout(400);
  await expect(page.locator('.ag-status-bar-center').getByLabel('Highlight pivot rows')).toBeChecked();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: resolve(SHOT_DIR, 'pivot-C3-top.png') });
  const go = page.locator('.ag-status-bar-center').getByRole('button', { name: /Go to pivot row/ });
  await go.click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(SHOT_DIR, 'pivot-C3-first.png') });
  await go.click();
  await go.click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(SHOT_DIR, 'pivot-C3-bottom.png') });
  console.log(
    await page.evaluate(() =>
      [...document.querySelectorAll('.ag-row[row-id="0"]')]
        .map((r) => {
          const cs = getComputedStyle(r);
          const cells = [...r.querySelectorAll('.ag-cell')].map((c) => `${c.getAttribute('col-id')} bg=${getComputedStyle(c).backgroundColor}`);
          return `${r.parentElement?.className} | row bgimg=${cs.backgroundImage.slice(0, 40)} shadow=${cs.boxShadow} | ${cells.join('; ')}`;
        })
        .join('\n'),
    ),
  );
});
