import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { load } from 'js-yaml';
import { grid, openAction } from '../actionTab';
import { test, expect } from '../realApi';

const NARROW = ['Development', 'Column views', 'Hosts by user'];
const WIDE = ['Development', 'Column views', 'Host sign-ins'];

const header = (page: Page, colId: string) =>
  grid(page).locator(`.ag-header-cell[col-id="${colId}"]`);
const pinnedLeft = (page: Page, colId: string) =>
  grid(page).locator(
    `.ag-header-row .ag-grid-pinned-left-cells .ag-header-cell[col-id="${colId}"]`,
  );
/** The result's columns shown, left to right (not TIM's or AG Grid's own). */
const shownColumns = (page: Page) =>
  grid(page)
    .locator('.ag-header-row-column .ag-header-cell[col-id]')
    .evaluateAll((cells) =>
      cells
        .map((c) => ({ id: c.getAttribute('col-id')!, x: c.getBoundingClientRect().left }))
        .filter(({ id }) => !id.startsWith('tim:') && !id.startsWith('ag-Grid-'))
        .sort((a, b) => a.x - b.x)
        .map(({ id }) => id),
    );
const status = (page: Page) => page.getByTestId('column-view-status').filter({ visible: true });

/** Runs the tab on show and waits for its grid. */
async function run(page: Page) {
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(grid(page).locator('.ag-row').first()).toBeVisible();
}

/** Opens a new tab of the action at `path` and runs it. */
async function runAction(page: Page, path: string[]) {
  await openAction(page, path);
  await run(page);
}

/** Opens a side bar tool panel of the tab on show; the grid is still settling right after a run. */
async function sideBar(
  page: Page,
  name: 'Columns' | 'Filters' | 'Views' | 'Action file',
  panel: Locator,
) {
  await expect(async () => {
    await grid(page).locator('.ag-side-button', { hasText: name }).click();
    await expect(panel).toBeVisible({ timeout: 1500 });
  }).toPass();
}

/** The Views panel of the tab on show, opened if it isn't. */
async function views(page: Page) {
  const panel = page.getByTestId('views-tool-panel').filter({ visible: true });
  if (!(await panel.isVisible())) await sideBar(page, 'Views', panel);
  return panel;
}

/** A row of the Views panel's list, found by its radio button, which is labelled with its name. */
const viewRow = (panel: Locator, name: string) =>
  panel
    .getByRole('listitem')
    .filter({ has: panel.page().getByRole('radio', { name, exact: true }) });

/** Clicks the row of `name` in the Views panel, which switches to it or asks first. */
async function chooseView(page: Page, name: string) {
  await (await views(page)).getByRole('radio', { name, exact: true }).click();
}

/** The items of the ⋯ menu of `name`'s row, which it leaves open. */
async function moreMenu(page: Page, name: string) {
  await (await views(page)).getByRole('button', { name: `More for ${name}` }).click();
  return page.getByRole('menu', { name });
}

async function fromMenu(page: Page, name: string, item: string) {
  await (await moreMenu(page, name)).getByRole('menuitem', { name: item }).click();
}

/** Waits for the snackbar saying `text`, and dismisses it so the next one shows straight away. */
async function snackbar(page: Page, text: string) {
  const bar = page.locator('.MuiSnackbar-root', { hasText: text });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Dismiss' }).click();
}

async function hideColumn(page: Page, colId: string) {
  const panel = grid(page).locator('.ag-column-select');
  if (!(await panel.isVisible())) await sideBar(page, 'Columns', panel);
  await panel
    .locator('.ag-column-select-column', { has: page.getByText(colId, { exact: true }) })
    .locator('.ag-column-select-checkbox')
    .click();
  await expect(header(page, colId)).toHaveCount(0);
}

/** Opens the column menu of `colId`; it sometimes misses the first click while the grid settles. */
async function columnMenu(page: Page, colId: string) {
  const menu = page.locator('.ag-menu').filter({ visible: true });
  await expect(async () => {
    if (!(await menu.isVisible())) {
      await header(page, colId).locator('.ag-header-cell-menu-button').click({ force: true });
    }
    await expect(menu).toBeVisible({ timeout: 1000 });
  }).toPass();
  return menu;
}

async function pinLeft(page: Page, colId: string) {
  const menu = await columnMenu(page, colId);
  const pinLeftOption = page.locator('.ag-menu-option', { hasText: 'Pin Left' });
  // The sub-menu sometimes misses the first hover.
  await expect(async () => {
    await menu.locator('.ag-menu-option', { hasText: 'Pin Column' }).hover();
    await expect(pinLeftOption).toBeVisible({ timeout: 1000 });
  }).toPass();
  await pinLeftOption.click();
  await expect(pinnedLeft(page, colId)).toBeVisible();
}

/**
 * Saves the tab's grid as a new column view, shared with everyone when `share`, and made the
 * default of the tab's preset or action when `asDefault`.
 */
async function saveView(page: Page, name: string, { share = false, asDefault = false } = {}) {
  await (await views(page)).getByRole('button', { name: /^Save( as new view)?…$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Save column view' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Share with everyone').setChecked(share);
  await dialog.getByLabel(/^Make it the default for/).setChecked(asDefault);
  await dialog.getByRole('button', { name: 'Save new view' }).click();
  await expect(dialog).toBeHidden();
  await expect(status(page)).toHaveText(`View:${name}`);
}

/** Makes `name` the Default view of the tab's preset or action, which is called `scopeName`. */
async function makeDefault(page: Page, name: string, scopeName: string) {
  await fromMenu(page, name, 'Make default');
  await snackbar(page, `"${scopeName}" now opens with "${name}".`);
}

test('a column view saved and made the default is what new tabs of the action open with', async ({
  page,
  idPrefix,
}) => {
  const name = `${idPrefix} Triage`;
  await runAction(page, WIDE);
  await expect(status(page)).toHaveText('View:Built-in');

  await hideColumn(page, 'User');
  await pinLeft(page, 'Host');
  const width = async () => (await header(page, 'Result').boundingBox())!.width;
  const before = await width();
  await (
    await columnMenu(page, 'Result')
  )
    .locator('.ag-menu-option', { hasText: 'Autosize This Column' })
    .click();
  await expect.poll(width).toBeLessThan(before - 20);
  const sized = await width();
  await header(page, 'Result').locator('.ag-header-cell-filter-button').click({ force: true });
  await page
    .locator('.ag-set-filter-item', { hasText: 'Failure' })
    .locator('input')
    .first()
    .uncheck();
  await page.keyboard.press('Escape');
  await expect(grid(page).locator('.ag-row [col-id="Result"]', { hasText: 'Failure' })).toHaveCount(
    0,
  );
  await expect(status(page)).toHaveText('View:Built-in • Edited');

  await saveView(page, name);
  await makeDefault(page, name, 'Host sign-ins');

  // A new tab of the same action opens with the Default view.
  await runAction(page, WIDE);
  await expect(status(page)).toHaveText(`View:${name}`);
  await expect(header(page, 'User')).toHaveCount(0);
  await expect(pinnedLeft(page, 'Host')).toBeVisible();
  await expect.poll(width).toBe(sized);
  await expect(grid(page).locator('.ag-row [col-id="Result"]')).toHaveText(['Success', 'Success']);

  // Discard puts back the view as it was picked.
  await pinLeft(page, 'Result');
  await expect(status(page)).toHaveText(`View:${name} • Edited`);
  const panel = await views(page);
  await expect(viewRow(panel, name)).toContainText('Edited');
  await panel.getByRole('button', { name: 'Discard' }).click();
  await expect(status(page)).toHaveText(`View:${name}`);
  await expect(pinnedLeft(page, 'Result')).toHaveCount(0);

  // Make default on Built-in goes back to the action's own columns.
  await makeDefault(page, 'Built-in', 'Host sign-ins');
  await runAction(page, WIDE);
  await expect(status(page)).toHaveText('View:Built-in');
  await expect(header(page, 'User')).toBeVisible();
});

test('switching views with the tab edited asks first: Cancel keeps the edits, Discard and switch drops them, Save first… saves them', async ({
  page,
  idPrefix,
}) => {
  const first = `${idPrefix} No users`;
  const second = `${idPrefix} Hosts pinned`;
  await runAction(page, WIDE);
  await hideColumn(page, 'User');
  await saveView(page, first);
  await pinLeft(page, 'Host');
  await expect(status(page)).toHaveText(`View:${first} • Edited`);

  const prompt = page.getByRole('dialog', { name: 'Switch to "Built-in"?' });
  await chooseView(page, 'Built-in');
  await expect(prompt).toContainText(
    `Your changes to "${first}" aren't saved. Switching views replaces this tab's columns and filters.`,
  );
  await prompt.getByRole('button', { name: 'Cancel' }).click();
  await expect(prompt).toBeHidden();
  await expect(status(page)).toHaveText(`View:${first} • Edited`);
  await expect(pinnedLeft(page, 'Host')).toBeVisible();

  await chooseView(page, 'Built-in');
  await prompt.getByRole('button', { name: 'Discard and switch' }).click();
  await expect(status(page)).toHaveText('View:Built-in');
  await expect(header(page, 'User')).toBeVisible();
  await expect(pinnedLeft(page, 'Host')).toHaveCount(0);

  // Save first… saves the edits as a new view, then switches.
  await pinLeft(page, 'Host');
  await expect(status(page)).toHaveText('View:Built-in • Edited');
  await chooseView(page, first);
  await page
    .getByRole('dialog', { name: `Switch to "${first}"?` })
    .getByRole('button', { name: 'Save first…' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Save column view' });
  await dialog.getByLabel('Name').fill(second);
  await dialog.getByRole('button', { name: 'Save new view' }).click();
  await expect(status(page)).toHaveText(`View:${first}`);
  await expect(header(page, 'User')).toHaveCount(0);
  await expect(pinnedLeft(page, 'Host')).toHaveCount(0);

  await chooseView(page, second);
  await expect(status(page)).toHaveText(`View:${second}`);
  await expect(pinnedLeft(page, 'Host')).toBeVisible();
  await expect(header(page, 'User')).toBeVisible();
});

test('a view saved with Make it the default ticked is the default, until Stop using as default', async ({
  page,
  idPrefix,
}) => {
  const name = `${idPrefix} Default from the start`;
  await runAction(page, WIDE);
  await hideColumn(page, 'User');
  await saveView(page, name, { asDefault: true });
  await snackbar(page, `"Host sign-ins" now opens with "${name}".`);
  await expect(viewRow(await views(page), name)).toContainText('Default');

  await runAction(page, WIDE);
  await expect(status(page)).toHaveText(`View:${name}`);
  await expect(header(page, 'User')).toHaveCount(0);

  await fromMenu(page, name, 'Stop using as default');
  await snackbar(page, '"Host sign-ins" now opens with "Built-in".');
  await expect(viewRow(await views(page), 'Built-in')).toContainText('Default');
  await runAction(page, WIDE);
  await expect(status(page)).toHaveText('View:Built-in');
  await expect(header(page, 'User')).toBeVisible();
});

test('Save… on your own edited view updates it while the name is unchanged, and saves a new view once it is changed', async ({
  page,
  idPrefix,
}) => {
  const name = `${idPrefix} Mine`;
  const copy = `${idPrefix} Mine, results pinned`;
  await runAction(page, WIDE);
  await hideColumn(page, 'User');
  await saveView(page, name);

  await pinLeft(page, 'Host');
  const panel = await views(page);
  await panel.getByRole('button', { name: 'Save…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save column view' });
  await expect(dialog.getByLabel('Name')).toHaveValue(name);
  await expect(dialog).toContainText('Change the name to save a new view instead.');
  await dialog.getByRole('button', { name: `Update "${name}"` }).click();
  await expect(status(page)).toHaveText(`View:${name}`);
  await chooseView(page, 'Built-in');
  await chooseView(page, name);
  await expect(pinnedLeft(page, 'Host')).toBeVisible();

  await pinLeft(page, 'Result');
  await panel.getByRole('button', { name: 'Save…' }).click();
  await dialog.getByLabel('Name').fill(copy);
  await expect(dialog).toContainText(`Saves a new view. "${name}" stays as it is.`);
  await dialog.getByRole('button', { name: 'Save new view' }).click();
  await expect(status(page)).toHaveText(`View:${copy}`);

  await chooseView(page, name);
  await expect(status(page)).toHaveText(`View:${name}`);
  await expect(pinnedLeft(page, 'Host')).toBeVisible();
  await expect(pinnedLeft(page, 'Result')).toHaveCount(0);
});

test("Rename… changes your own view's name and sharing but not its columns, and isn't offered on someone else's", async ({
  page,
  idPrefix,
  signIn,
}) => {
  const name = `${idPrefix} Draft`;
  const renamed = `${idPrefix} Users first`;
  await runAction(page, NARROW);
  await pinLeft(page, 'User');
  await saveView(page, name);

  await fromMenu(page, name, 'Rename…');
  const dialog = page.getByRole('dialog', { name: `Rename "${name}"` });
  await dialog.getByLabel('Name').fill(renamed);
  await dialog.getByLabel('Share with everyone').check();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(status(page)).toHaveText(`View:${renamed}`);
  const panel = await views(page);
  await expect(viewRow(panel, name)).toHaveCount(0);
  await chooseView(page, 'Built-in');
  await chooseView(page, renamed);
  await expect(pinnedLeft(page, 'User')).toBeVisible();

  // Bob sees it, now it's shared, and can't rename it.
  const bob = await signIn(`${idPrefix}.bob@example.com`);
  await runAction(bob.page, NARROW);
  const menu = await moreMenu(bob.page, renamed);
  await expect(menu.getByRole('menuitem', { name: 'Make default' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Rename…' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Delete…' })).toHaveCount(0);
});

test('a view saved on a narrower result fits a wider one, which another analyst ranks by matching columns and can hide', async ({
  page,
  idPrefix,
  signIn,
}) => {
  const shared = `${idPrefix} Users first`;
  const mine = `${idPrefix} Private`;
  await runAction(page, NARROW);
  await pinLeft(page, 'User');
  await saveView(page, shared, { share: true });
  await saveView(page, mine);

  // On the wider result the view's columns are kept and the missing ones appended as declared.
  await runAction(page, WIDE);
  await expect.poll(() => shownColumns(page)).toEqual(['Result', 'Host', 'User']);
  let panel = await views(page);
  await expect(panel.getByText('Saved elsewhere')).toBeVisible();
  await chooseView(page, shared);
  await expect(status(page)).toHaveText(`View:${shared}`);
  await expect(pinnedLeft(page, 'User')).toBeVisible();
  await expect.poll(() => shownColumns(page)).toEqual(['User', 'Host', 'Result']);

  // Bob sees the shared view saved elsewhere, by how many of his columns it matches.
  const bob = await signIn(`${idPrefix}.bob@example.com`);
  await runAction(bob.page, WIDE);
  panel = await views(bob.page);
  await expect(viewRow(panel, shared)).toContainText('From Hosts by user · 2 of 4 columns');
  await expect(viewRow(panel, mine)).toHaveCount(0);

  // He hides it for himself, and lists it again through Show 1 hidden view.
  await fromMenu(bob.page, shared, 'Hide from this list');
  await expect(viewRow(panel, shared)).toHaveCount(0);
  await panel.getByRole('button', { name: 'Show 1 hidden view' }).click();
  await expect(viewRow(panel, shared)).toBeVisible();
  await fromMenu(bob.page, shared, 'Show in this list');
  await expect(panel.getByRole('button', { name: /hidden view/ })).toHaveCount(0);
  await expect(viewRow(panel, shared)).toBeVisible();
});

test("a preset's Default view is its own, and doesn't fall back to its action's", async ({
  page,
  idPrefix,
}) => {
  const actionView = `${idPrefix} Action view`;
  const presetView = `${idPrefix} Preset view`;
  const preset = `${idPrefix} Wide preset`;

  await runAction(page, WIDE);
  await hideColumn(page, 'User');
  await saveView(page, actionView);
  await makeDefault(page, actionView, 'Host sign-ins');

  // A preset of the action opens with Built-in.
  await runAction(page, WIDE);
  await page.getByRole('button', { name: 'Save…' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Save preset' });
  await dialog.getByLabel('Name').fill(preset);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const openPreset = async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.getByLabel('Search queries').fill(idPrefix);
    await page.getByRole('menu').first().getByText(preset, { exact: true }).click();
    await expect(page.getByRole('heading', { name: preset })).toBeVisible();
    await run(page);
  };
  await openPreset();
  await expect(status(page)).toHaveText('View:Built-in');
  await expect(header(page, 'User')).toBeVisible();

  await hideColumn(page, 'Result');
  await saveView(page, presetView);
  await makeDefault(page, presetView, preset);

  await openPreset();
  await expect(status(page)).toHaveText(`View:${presetView}`);
  await expect(header(page, 'Result')).toHaveCount(0);
  await runAction(page, WIDE);
  await expect(status(page)).toHaveText(`View:${actionView}`);
  await expect(header(page, 'User')).toHaveCount(0);
  await expect(header(page, 'Result')).toBeVisible();
});

test('a deleted Default view is warned about, and new tabs open with Built-in', async ({
  page,
  idPrefix,
}) => {
  const name = `${idPrefix} Short-lived`;
  await runAction(page, WIDE);
  await hideColumn(page, 'User');
  await saveView(page, name);
  await makeDefault(page, name, 'Host sign-ins');

  const panel = await views(page);
  await fromMenu(page, name, 'Delete…');
  await page
    .getByRole('dialog', { name: `Delete "${name}"?` })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(viewRow(panel, name)).toHaveCount(0);

  await runAction(page, WIDE);
  await expect(
    page.getByText(`Default view "${name}" is gone, so the tab opens with "Built-in".`),
  ).toBeVisible();
  await expect(status(page)).toHaveText('View:Built-in');
  await expect(header(page, 'User')).toBeVisible();
});

test("the Action file panel copies the tab's columns as an action file's columns: block, which reproduces them", async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await runAction(page, WIDE);
  const panel = page.getByTestId('action-file-tool-panel').filter({ visible: true });
  const block = panel.locator('pre');

  const columns = grid(page).locator('.ag-column-select');
  await sideBar(page, 'Columns', columns);
  await columns
    .locator('.ag-column-select-column', { has: page.getByText('Label', { exact: true }) })
    .locator('.ag-column-select-checkbox')
    .click();
  await expect(header(page, 'tim:label')).toBeVisible();
  await sideBar(page, 'Action file', panel);
  await expect(block).toContainText('- name: tim:label');
  await expect(block).not.toContainText('pinned');
  await pinLeft(page, 'Host');
  await expect(block).toContainText('pinned: left');

  await panel.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Copied the column settings')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());

  // Pasted into an action file, it passes `tim-api check`.
  const dir = mkdtempSync(join(tmpdir(), 'tim-action-file-'));
  writeFileSync(
    join(dir, 'pasted.yaml'),
    `type: dev_rows\nkey: pasted\nname: Pasted\npivot: none\n${copied}`,
  );
  execFileSync(
    'uv',
    ['run', '--project', '../api', 'tim-api', 'check', '--dev-actions', '--actions', dir],
    { stdio: 'pipe' },
  );

  // It is the columns: of Host sign-ins (laid out), whose tabs start with the same columns.
  const fixture = load(
    readFileSync(resolve(import.meta.dirname, '../actions/action-file.yaml'), 'utf8'),
  ) as { columns: unknown };
  expect(load(copied)).toEqual({ columns: fixture.columns });
  await runAction(page, ['Development', 'Action file', 'Host sign-ins (laid out)']);
  await expect(pinnedLeft(page, 'Host')).toBeVisible();
  await expect(header(page, 'Region')).toHaveCount(0);
  await expect(header(page, 'tim:label')).toBeVisible();
  expect(await shownColumns(page)).toEqual(['Host', 'Result', 'User']);
});
