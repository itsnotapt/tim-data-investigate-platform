import type { Page } from '@playwright/test';
import { grid, openAction } from '../actionTab';
import { test, expect } from '../realApi';

const row = (page: Page, index: number) => grid(page).locator(`.ag-row[row-index="${index}"]`);
const viewport = (page: Page) => grid(page).locator('.ag-grid-viewport');
const scrollTopOf = (page: Page) => viewport(page).evaluate((el) => el.scrollTop);
const menuOption = (page: Page, name: string) =>
  page.locator('.ag-menu-option').filter({ hasText: new RegExp(`^${name}$`) });

/** The index of the top row the grid shows in full. */
const firstRowInView = (page: Page) =>
  viewport(page).evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    const rows = [...el.querySelectorAll<HTMLElement>('.ag-row')];
    const inView = rows.filter((r) => r.getBoundingClientRect().top >= top);
    return Math.min(...inView.map((r) => Number(r.getAttribute('row-index'))));
  });

/** Goes back to the Generated rows tab. */
async function backToGeneratedRows(page: Page) {
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Generated rows' })).toBeVisible();
}

/** Opens and runs Generated rows: 2500 rows, Host-1 to Host-2500. */
async function runGeneratedRows(page: Page) {
  await openAction(page, ['Development', 'Rows', 'Generated rows']);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: 'Results · 2500' })).toBeVisible();
}

/** Pivots from the row's Host cell to Host list, which opens in another tab, and goes to it. */
async function goToHostList(page: Page, index: number) {
  await row(page, index).locator('[col-id="Host"]').click({ button: 'right' });
  for (const step of ['Pivot', 'Development', 'Pivots']) await menuOption(page, step).hover();
  await menuOption(page, 'Host list').click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Running Host list' })
    .last()
    .getByRole('button', { name: 'Go to' })
    .click();
  await expect(page.getByRole('heading', { name: 'Host list' })).toBeVisible();
}

test('a grid keeps its scroll position, focused cell and selection when its tab is switched away and back', async ({
  page,
}) => {
  await runGeneratedRows(page);
  await grid(page).hover();
  await page.mouse.wheel(0, 30_000);
  await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(20_000);
  const scrollTop = await scrollTopOf(page);
  const focusedIndex = (await firstRowInView(page)) + 3;
  const checkbox = row(page, focusedIndex).locator('.ag-checkbox-input').first();
  await checkbox.check({ force: true });
  const host = row(page, focusedIndex).locator('[col-id="Host"]');
  await host.click();
  await expect(host).toHaveClass(/ag-cell-focus/);

  await goToHostList(page, focusedIndex);
  await backToGeneratedRows(page);

  await expect.poll(() => scrollTopOf(page)).toBe(scrollTop);
  await expect(row(page, focusedIndex)).toBeInViewport();
  await expect(host).toHaveClass(/ag-cell-focus/);
  await expect(checkbox).toBeChecked();
  await expect(grid(page).locator('.ag-status-bar')).toContainText(/Selected\s*:\s*1/);
});

test('a grid keeps its column widths and order when its tab is switched away and back', async ({
  page,
}) => {
  await runGeneratedRows(page);
  const header = (column: string) => grid(page).locator(`.ag-header-cell[col-id="${column}"]`);
  const box = async (column: string) => (await header(column).boundingBox())!;

  // Widens Host by dragging its resize handle.
  const host = await box('Host');
  const handle = (await header('Host').locator('.ag-header-cell-resize').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 150, handle.y + handle.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await box('Host')).width).toBeGreaterThan(host.width + 100);
  const width = (await box('Host')).width;

  // Moves Bytes before Host by dragging its header.
  const bytes = await box('Bytes');
  await page.mouse.move(bytes.x + bytes.width / 2, bytes.y + bytes.height / 2);
  await page.mouse.down();
  await page.mouse.move(host.x + 10, bytes.y + bytes.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect.poll(async () => (await box('Bytes')).x).toBeLessThan((await box('Host')).x);

  await goToHostList(page, 0);
  await backToGeneratedRows(page);

  expect((await box('Bytes')).x).toBeLessThan((await box('Host')).x);
  expect((await box('Host')).width).toBe(width);
});

/**
 * Shows the tab at `url` through the address bar, as the tree does, and returns the milliseconds
 * from the navigation until the frame after its `title` shows.
 */
const switchTime = (page: Page, url: string, title: string) =>
  page.evaluate(
    async ({ hash, title }) => {
      const start = performance.now();
      window.location.hash = hash;
      const shown = () =>
        [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].some(
          (h) => h.textContent === title && h.checkVisibility({ visibilityProperty: true }),
        );
      while (!shown()) await new Promise(requestAnimationFrame);
      await new Promise((painted) => requestAnimationFrame(() => setTimeout(painted)));
      return performance.now() - start;
    },
    { hash: new URL(url).hash, title },
  );

type Resizable = { resized: Promise<number> };

/**
 * Resizes the window and returns the milliseconds from its `resize` event until the frame after.
 */
async function resizeTime(page: Page, size: { width: number; height: number }) {
  await page.evaluate(() => {
    const w = window as unknown as Resizable;
    w.resized = new Promise((resolve) =>
      window.addEventListener(
        'resize',
        () => {
          const start = performance.now();
          requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - start)));
        },
        { once: true },
      ),
    );
  });
  await page.setViewportSize(size);
  return page.evaluate(() => (window as unknown as Resizable).resized);
}

const median = (times: number[]) => times.toSorted((a, b) => a - b)[Math.floor(times.length / 2)]!;

test('switching tabs and resizing the window stay quick with 20 tabs mounted', async ({ page }) => {
  test.setTimeout(180_000);
  await runGeneratedRows(page);
  const tabs = [{ url: page.url(), title: 'Generated rows' }];
  for (let i = 0; i < 19; i++) {
    await goToHostList(page, i);
    await expect(page.getByRole('tab', { name: 'Results · 2500' })).toBeVisible();
    const title = await page.getByRole('heading', { name: 'Host list' }).textContent();
    tabs.push({ url: page.url(), title: title! });
    await backToGeneratedRows(page);
  }

  const switches: number[] = [];
  for (let round = 0; round < 3; round++)
    for (const tab of tabs.slice(-5)) switches.push(await switchTime(page, tab.url, tab.title));
  const resizes: number[] = [];
  for (let i = 0; i < 10; i++)
    resizes.push(
      await resizeTime(page, i % 2 ? { width: 1440, height: 900 } : { width: 1000, height: 700 }),
    );

  expect(median(switches)).toBeLessThan(100);
  expect(median(resizes)).toBeLessThan(100);
});
