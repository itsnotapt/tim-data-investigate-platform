import type { Page, Request } from '@playwright/test';
import { grid } from '../actionTab';
import { test, expect } from '../realApi';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Annotate' });
const toast = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });
const row = (page: Page, index: number) => grid(page).locator(`.ag-row[row-index="${index}"]`);
const select = (page: Page, index: number) =>
  row(page, index).locator('.ag-checkbox-input').first().check({ force: true });
const menuOption = (page: Page, name: string) =>
  page.locator('.ag-menu-option').filter({ hasText: new RegExp(`^${name}$`) });

/** Opens the development JSON action with `rows`, each row's id from `Host`, and runs it. */
async function runJson(page: Page, rows: Record<string, unknown>[]) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('button', { name: 'Development', exact: true }).click();
  await page.getByRole('button', { name: 'JSON (development)', exact: true }).click();
  await page.getByRole('button', { name: /^Rows: / }).click();
  await page.getByRole('textbox', { name: 'Rows' }).fill(JSON.stringify(rows));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Id column: / }).click();
  await page.getByRole('textbox', { name: 'Id column' }).fill('Host');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('tab', { name: `Results · ${rows.length}` })).toBeVisible();
}

/** Right-clicks row `index`'s Host, then runs the sink `name` from Send to ▸ Development ▸. */
async function runSinkFromMenu(page: Page, index: number, name: string) {
  await row(page, index).locator('[col-id="Host"]').click({ button: 'right' });
  await menuOption(page, 'Send to').hover();
  await menuOption(page, 'Development').hover();
  await menuOption(page, name.replace(/[()]/g, '\\$&')).click();
}

/** The bodies of the requests that start runs. */
function runStarts(page: Page): unknown[] {
  const bodies: unknown[] = [];
  page.on('request', (r: Request) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/runs') {
      bodies.push(r.postDataJSON());
    }
  });
  return bodies;
}

test('annotating with a sink picked saves the change, then the sink takes every column of the rows', async ({
  page,
  idPrefix,
}) => {
  const [a, b] = [`${idPrefix}-a`, `${idPrefix}-b`];
  await runJson(page, [
    { Host: a, Bytes: 10 },
    { Host: b, Bytes: 20 },
  ]);
  const order: string[] = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (['/api/annotations', '/api/runs'].includes(path) && r.method() !== 'GET') order.push(path);
  });
  const starts = runStarts(page);

  await select(page, 0);
  await select(page, 1);
  await grid(page).getByText(a).click();
  await page.keyboard.press('t');
  const picker = dialog(page).getByRole('combobox', { name: 'After tagging, run…' });
  await expect(picker).toHaveText('None');
  await picker.click();
  await page.getByRole('option', { name: 'Save event', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Malicious' }).click();
  await dialog(page).getByRole('button', { name: 'Save and run Save event' }).click();
  await expect(toast(page, 'Save event: 2 rows')).toBeVisible();
  expect(order).toEqual(['/api/annotations', '/api/runs']);
  expect(starts).toEqual([
    {
      action: 'dev-save',
      params: {},
      input: {
        columns: [
          { name: 'Host', type: 'string' },
          { name: 'Bytes', type: 'number' },
        ],
        rows: [
          { Host: a, Bytes: 10 },
          { Host: b, Bytes: 20 },
        ],
      },
    },
  ]);

  // The sink run last is picked first next time.
  await grid(page).getByText(a).click();
  await page.keyboard.press('t');
  await expect(picker).toHaveText('Save event');
  await page.keyboard.press('Escape');
});

test('a sink that fails shows the error with Retry, which sends the same rows again', async ({
  page,
  idPrefix,
}) => {
  await runJson(page, [{ Host: `${idPrefix}-a` }]);
  const starts = runStarts(page);

  await runSinkFromMenu(page, 0, 'Save event (refused)');
  const failed = toast(page, 'Save event (refused): The event store refused the rows');
  await expect(failed).toBeVisible();
  await failed.getByRole('button', { name: 'Retry' }).click();
  await expect(failed).toBeVisible();
  await expect.poll(() => starts.length).toBe(2);
  expect(starts[1]).toEqual(starts[0]);
});

test('a reload while a sink runs shows how it ended, once', async ({ page, idPrefix }) => {
  await runJson(page, [{ Host: `${idPrefix}-a` }, { Host: `${idPrefix}-b` }]);
  await select(page, 0);
  await select(page, 1);
  const started = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/runs',
  );
  await runSinkFromMenu(page, 0, 'Save event (slow)');
  await started;
  const pending = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem('tim-pending-sink-runs') ?? '[]') as unknown[],
    );
  await expect.poll(pending).toHaveLength(1);

  await page.reload();
  await expect(toast(page, 'Save event (slow): 2 rows')).toBeVisible();
  await expect.poll(pending).toEqual([]);
  await expect(toast(page, 'Save event (slow)').getByRole('button', { name: 'Retry' })).toHaveCount(
    0,
  );
});

test('the sinks are in the context menu under their menu path, disabled over the most rows a sink takes', async ({
  page,
  idPrefix,
}) => {
  // The e2e api takes at most 5 (TIM_MAX_ANNOTATION_IDS).
  await runJson(
    page,
    Array.from({ length: 6 }, (_, i) => ({ Host: `${idPrefix}-${i}` })),
  );
  await row(page, 0).locator('[col-id="Host"]').click({ button: 'right' });
  await menuOption(page, 'Send to').hover();
  await menuOption(page, 'Development').hover();
  await expect(menuOption(page, 'Save event')).toBeVisible();
  await expect(menuOption(page, 'Save event \\(slow\\)')).toBeVisible();
  await page.keyboard.press('Escape');

  for (let i = 0; i < 6; i++) await select(page, i);
  await row(page, 0).locator('[col-id="Host"]').click({ button: 'right' });
  await menuOption(page, 'Send to').hover();
  await menuOption(page, 'Development').hover();
  await expect(menuOption(page, 'Save event')).toHaveClass(/ag-menu-option-disabled/);
  await menuOption(page, 'Save event').hover();
  await expect(page.getByText('At most 5 rows; 6 selected')).toBeVisible();
});
