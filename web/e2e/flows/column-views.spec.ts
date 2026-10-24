import type { Locator, Page } from '@playwright/test';
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
async function sideBar(page: Page, name: 'Columns' | 'Filters' | 'Views', panel: Locator) {
  await expect(async () => {
    await grid(page).locator('.ag-side-button', { hasText: name }).click();
    await expect(panel).toBeVisible({ timeout: 1500 });
  }).toPass();
}

/** A view in the Views panel's list, whose name is followed by how many columns it matches. */
const viewItem = (panel: Locator, name: string) =>
  panel.getByRole('button', { name: new RegExp(`^${name}`) });

async function views(page: Page) {
  const panel = page.getByTestId('views-tool-panel').filter({ visible: true });
  if (!(await panel.isVisible())) await sideBar(page, 'Views', panel);
  return panel;
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

/** Saves the tab's grid as a new column view, shared with everyone when `share`. */
async function saveView(page: Page, name: string, { share = false } = {}) {
  await (await views(page)).getByRole('button', { name: 'Save…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save column view' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Share with everyone').setChecked(share);
  await dialog.getByRole('button', { name: /^Save( as new)?$/ }).click();
  await expect(dialog).toBeHidden();
  await expect(status(page)).toHaveText(`View:${name}`);
}

async function applyView(page: Page, name: string) {
  await (await views(page)).getByRole('button', { name: 'Apply' }).click();
  await expect(status(page)).toHaveText(`View:${name} (applied)`);
}

test('a column view saved and applied is what new tabs of the action start with', async ({
  page,
  idPrefix,
}) => {
  const name = `${idPrefix} Triage`;
  await runAction(page, WIDE);
  await expect(status(page)).toHaveText('View:Action default (applied)');

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
  await expect(status(page)).toHaveText('View:Action default (applied) • modified');

  await saveView(page, name);
  await applyView(page, name);

  // A new tab of the same action starts with the applied view.
  await runAction(page, WIDE);
  await expect(status(page)).toHaveText(`View:${name} (applied)`);
  await expect(header(page, 'User')).toHaveCount(0);
  await expect(pinnedLeft(page, 'Host')).toBeVisible();
  await expect.poll(width).toBe(sized);
  await expect(grid(page).locator('.ag-row [col-id="Result"]')).toHaveText(['Success', 'Success']);

  // Reverting puts back the view as it was picked.
  await pinLeft(page, 'Result');
  await expect(status(page)).toHaveText(`View:${name} (applied) • modified`);
  await (await views(page)).getByRole('button', { name: 'Revert' }).click();
  await expect(status(page)).toHaveText(`View:${name} (applied)`);
  await expect(pinnedLeft(page, 'Result')).toHaveCount(0);
});

test('a view saved on a narrower result fits a wider one, which another analyst ranks by matching columns', async ({
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
  await expect(panel.getByText('Other views')).toBeVisible();
  await viewItem(panel, shared).click();
  await expect(status(page)).toHaveText(`View:${shared}`);
  await expect(pinnedLeft(page, 'User')).toBeVisible();
  await expect.poll(() => shownColumns(page)).toEqual(['User', 'Host', 'Result']);

  // Bob sees the shared view among the others, by how many of his columns it matches.
  const bob = await signIn(`${idPrefix}.bob@example.com`);
  await runAction(bob.page, WIDE);
  panel = await views(bob.page);
  await expect(viewItem(panel, shared)).toContainText('2 of 4 columns match');
  await expect(viewItem(panel, mine)).toHaveCount(0);

  // He hides it for himself, and finds it again with Hidden on.
  await panel.getByRole('button', { name: `More for ${shared}` }).click();
  await bob.page
    .getByRole('menu', { name: shared })
    .getByRole('menuitem', { name: 'Hide' })
    .click();
  await expect(viewItem(panel, shared)).toHaveCount(0);
  await panel.getByLabel('Hidden').check();
  await panel.getByRole('button', { name: `More for ${shared}` }).click();
  await bob.page
    .getByRole('menu', { name: shared })
    .getByRole('menuitem', { name: 'Unhide' })
    .click();
  await panel.getByLabel('Hidden').uncheck();
  await expect(viewItem(panel, shared)).toBeVisible();
});

test("a preset's applied view is its own, and doesn't fall back to its action's", async ({
  page,
  idPrefix,
}) => {
  const actionView = `${idPrefix} Action view`;
  const presetView = `${idPrefix} Preset view`;
  const preset = `${idPrefix} Wide preset`;

  await runAction(page, WIDE);
  await hideColumn(page, 'User');
  await saveView(page, actionView);
  await applyView(page, actionView);

  // A preset of the action starts with the action default.
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
  await expect(status(page)).toHaveText('View:Action default (applied)');
  await expect(header(page, 'User')).toBeVisible();

  await hideColumn(page, 'Result');
  await saveView(page, presetView);
  await applyView(page, presetView);

  await openPreset();
  await expect(status(page)).toHaveText(`View:${presetView} (applied)`);
  await expect(header(page, 'Result')).toHaveCount(0);
  await runAction(page, WIDE);
  await expect(status(page)).toHaveText(`View:${actionView} (applied)`);
  await expect(header(page, 'User')).toHaveCount(0);
  await expect(header(page, 'Result')).toBeVisible();
});

test('a deleted applied view is warned about, and new tabs start with the action default', async ({
  page,
  idPrefix,
}) => {
  const name = `${idPrefix} Short-lived`;
  await runAction(page, WIDE);
  await hideColumn(page, 'User');
  await saveView(page, name);
  await applyView(page, name);

  const panel = await views(page);
  await panel.getByRole('button', { name: `More for ${name}` }).click();
  await page.getByRole('menu', { name }).getByRole('menuitem', { name: 'Delete…' }).click();
  await page
    .getByRole('dialog', { name: `Delete "${name}"?` })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(viewItem(panel, name)).toHaveCount(0);

  await runAction(page, WIDE);
  await expect(
    page.getByText(`Column view "${name}" is gone, so the tab starts with the action default.`),
  ).toBeVisible();
  await expect(status(page)).toHaveText('View:Action default (applied)');
  await expect(header(page, 'User')).toBeVisible();
});
