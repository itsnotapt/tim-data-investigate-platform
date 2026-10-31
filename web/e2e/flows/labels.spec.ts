import type { Page, Request } from '@playwright/test';
import { test, expect } from '../realApi';
import { setIdColumn } from '../actionTab';

const grid = (page: Page) => page.getByTestId('results-grid');
const menuOption = (page: Page, text: string | RegExp) =>
  page.locator('.ag-menu-option', { hasText: text });

/** The grid rows whose Host is `host` (the part of each row beside the pinned selection column). */
const rowsWith = (page: Page, host: string) =>
  grid(page)
    .locator('.ag-row')
    .filter({ has: page.locator('.ag-cell[col-id="Host"]', { hasText: host }) });

/** Opens the development JSON action with `rows`, each row's id from `Host`, and runs it. */
async function runJson(page: Page, rows: Record<string, unknown>[], idColumn: string | null) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('button', { name: 'Development', exact: true }).click();
  await page.getByRole('button', { name: 'JSON (development)', exact: true }).click();
  await page.getByRole('button', { name: /^Rows: / }).click();
  await page.getByRole('textbox', { name: 'Rows' }).fill(JSON.stringify(rows));
  await page.keyboard.press('Escape');
  if (idColumn !== null) {
    await setIdColumn(page, idColumn);
  }
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: `Results · ${rows.length}` })).toBeVisible();
}

/** Starts recording whether any grid cell flashes. */
async function watchFlashes(page: Page) {
  await page.evaluate(() => {
    const flags = window as unknown as { flashed: boolean };
    flags.flashed = false;
    new MutationObserver((records) => {
      for (const r of records) {
        if ((r.target as Element).classList.contains('ag-cell-data-changed')) flags.flashed = true;
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
}

const flashed = (page: Page) =>
  page.evaluate(() => (window as unknown as { flashed: boolean }).flashed);

test('a label set with key 1 reaches every row with that id, in another tab and another analyst’s browser', async ({
  page,
  analyst,
  signIn,
  idPrefix,
}) => {
  const a = `${idPrefix}-a`;
  const b = `${idPrefix}-b`;
  await runJson(page, [{ Host: a }, { Host: b }, { Host: a }], 'Host');
  const otherTab = await analyst.context.newPage();
  await runJson(otherTab, [{ Host: a }], 'Host');
  const teammate = await signIn(`${idPrefix}.teammate@example.com`);
  await runJson(teammate.page, [{ Host: a }, { Host: b }], 'Host');
  await watchFlashes(teammate.page);

  await page.bringToFront();
  await grid(page).getByText(a).first().click();
  await page.keyboard.press('1');
  await expect(page.getByText('Labelled 1 id Malicious')).toBeVisible();
  await expect(rowsWith(page, a)).toHaveCount(2);
  for (const row of await rowsWith(page, a).all()) await expect(row).toHaveClass(/tim-label-red/);
  await expect(grid(page).getByRole('img', { name: 'Malicious' })).toHaveCount(2);
  await expect(rowsWith(page, b)).not.toHaveClass(/tim-label/);
  await expect(rowsWith(otherTab, a)).toHaveClass(/tim-label-red/);
  await expect(rowsWith(teammate.page, a)).toHaveClass(/tim-label-red/);
  await expect(rowsWith(teammate.page, b)).not.toHaveClass(/tim-label/);
  expect(await flashed(teammate.page)).toBe(true);
});

test('Label ▸ lists the labels file’s labels; clearing a label reaches the other browser and keeps the id', async ({
  page,
  analyst,
  signIn,
  idPrefix,
}) => {
  const a = `${idPrefix}-a`;
  await runJson(page, [{ Host: a }], 'Host');
  const teammate = await signIn(`${idPrefix}.teammate@example.com`);
  await runJson(teammate.page, [{ Host: a }], 'Host');

  await grid(page).getByText(a).click({ button: 'right' });
  await menuOption(page, /^Label/).hover();
  const items = menuOption(page, /Malicious|Escalated|Benign|Clear label/);
  await expect(items).toHaveText([
    /Malicious\s*1/,
    /Escalated\s*2/,
    /Benign\s*3/,
    /Clear label\s*0/,
  ]);
  await menuOption(page, 'Escalated').click();
  await expect(rowsWith(page, a)).toHaveClass(/tim-label-blue/);
  await expect(grid(page).getByRole('img', { name: 'Escalated' })).toBeVisible();
  await expect(rowsWith(teammate.page, a)).toHaveClass(/tim-label-blue/);

  await page.bringToFront();
  await grid(page).getByText(a).click();
  await page.keyboard.press('0');
  await expect(page.getByText('Cleared the label of 1 id')).toBeVisible();
  await expect(rowsWith(page, a)).not.toHaveClass(/tim-label/);
  await expect(rowsWith(teammate.page, a)).not.toHaveClass(/tim-label/);

  const feed = await analyst.get('/api/annotations/changes?since=0');
  const { changes } = (await feed.json()) as { changes: { id: string; label: unknown }[] };
  expect(changes.find((c) => c.id === a)).toMatchObject({ id: a, label: null });
});

test('right-clicking a row that isn’t selected labels just that row; with rows selected, the selection is labelled', async ({
  page,
  idPrefix,
}) => {
  const [a, b, c] = ['a', 'b', 'c'].map((s) => `${idPrefix}-${s}`) as [string, string, string];
  await runJson(page, [{ Host: a }, { Host: b }, { Host: c }], 'Host');
  await grid(page).getByText(a).click();
  await page.keyboard.press('2');
  await expect(rowsWith(page, a)).toHaveClass(/tim-label-blue/);

  await rowsWith(page, a).locator('.ag-checkbox-input').check({ force: true });
  await grid(page).getByText(c).click({ button: 'right' });
  await menuOption(page, /^Label/).hover();
  await menuOption(page, 'Benign').click();
  await expect(rowsWith(page, c)).toHaveClass(/tim-label-green/);
  await expect(rowsWith(page, a)).toHaveClass(/tim-label-blue/);
  await expect(rowsWith(page, a)).not.toHaveClass(/ag-row-selected/);

  for (const host of [a, b]) {
    await rowsWith(page, host).locator('.ag-checkbox-input').check({ force: true });
  }
  await rowsWith(page, c).locator('.ag-checkbox-input').uncheck({ force: true });
  await grid(page).getByText(a).click();
  await page.keyboard.press('1');
  await expect(page.getByText('Labelled 2 ids Malicious')).toBeVisible();
  await expect(rowsWith(page, a)).toHaveClass(/tim-label-red/);
  await expect(rowsWith(page, b)).toHaveClass(/tim-label-red/);
  await expect(rowsWith(page, c)).toHaveClass(/tim-label-green/);
});

test('a cell’s Use … as Id column gives rows run without one their ids, to label at once', async ({
  page,
  idPrefix,
}) => {
  const [a, b] = [`${idPrefix}-a`, `${idPrefix}-b`];
  await runJson(
    page,
    [
      { Host: a, Seen: 1 },
      { Host: b, Seen: 2 },
      { Host: a, Seen: 3 },
    ],
    null,
  );
  await grid(page).getByText(b).click({ button: 'right' });
  await menuOption(page, 'Use Host as Id column').click();
  await expect(page.getByText('Id column set to Host: labels now follow Host')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Id column: Host' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edited' })).toBeHidden();

  await grid(page).getByText(a).first().click({ button: 'right' });
  await menuOption(page, /^Label/).hover();
  await menuOption(page, 'Malicious').click();
  await expect(page.getByText('Labelled 1 id Malicious')).toBeVisible();
  for (const row of await rowsWith(page, a).all()) await expect(row).toHaveClass(/tim-label-red/);
  await expect(rowsWith(page, b)).not.toHaveClass(/tim-label/);
});

test('rows without an id, or more ids than one change takes, say why they can’t be labelled', async ({
  page,
  idPrefix,
}) => {
  await runJson(page, [{ Host: `${idPrefix}-none` }], null);
  await grid(page).getByText(`${idPrefix}-none`).click({ button: 'right' });
  await menuOption(page, /^Label/).hover();
  await expect(menuOption(page, 'Malicious')).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await grid(page).getByText(`${idPrefix}-none`).click();
  await page.keyboard.press('1');
  await expect(
    page.getByText('No id: right-click a cell and use its column as the Id column'),
  ).toBeVisible();

  // The e2e api takes at most 5 ids in one change.
  const many = Array.from({ length: 6 }, (_, i) => ({ Host: `${idPrefix}-${i}` }));
  await runJson(page, many, 'Host');
  await grid(page).locator('.ag-header-select-all .ag-checkbox-input').check({ force: true });
  await grid(page).getByText(`${idPrefix}-0`).click();
  await page.keyboard.press('1');
  await expect(page.getByText('At most 5 ids; 6 selected')).toBeVisible();
});

test('a stored label no longer in the labels file shows grey as its bare key', async ({
  page,
  idPrefix,
}) => {
  const id = `${idPrefix}-old`;
  // The api only takes configured keys; the change feed brings one from an older labels file.
  await page.route('**/api/annotations/changes**', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { changes: unknown[] };
    body.changes.push({
      id,
      label: { key: 'retired', by: 'someone@example.com', at: '2026-10-01T08:00:00Z' },
      tags: [],
      comments: [],
      version: 1,
    });
    await route.fulfill({ response, json: body });
  });
  await runJson(page, [{ Host: id }], 'Host');
  await expect(rowsWith(page, id)).toHaveClass(/tim-label-grey/);
  await expect(grid(page).getByRole('img')).toHaveCount(0);
});

test('one tab of a browser reads the change feed for all of them', async ({
  page,
  analyst,
  idPrefix,
}) => {
  const readers = new Set<Page>();
  analyst.context.on('request', (request: Request) => {
    if (new URL(request.url()).pathname !== '/api/annotations/changes') return;
    readers.add(request.frame().page());
  });
  await runJson(page, [{ Host: `${idPrefix}-a` }], 'Host');
  const otherTab = await analyst.context.newPage();
  await runJson(otherTab, [{ Host: `${idPrefix}-a` }], 'Host');
  // A few polls, and a focus of each tab.
  await page.bringToFront();
  await otherTab.bringToFront();
  await page.waitForTimeout(5_000);
  expect(readers.size).toBe(1);
});
