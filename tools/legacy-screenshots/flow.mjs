import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';
const OUT = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 160)));
await installMocks(page, (l) => console.log('  api', l));
let n = 0;
const shot = async (name, wait = 600) => { await page.waitForTimeout(wait); const f = `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: f }); console.log('shot', f); };
const step = async (label, fn) => { try { await fn(); } catch (e) { console.log(`STEP FAILED [${label}]:`, e.message.split('\n')[0]); await page.keyboard.press('Escape').catch(() => {}); } };
const B = 'http://localhost:5173/#';

await page.goto(`${B}/`); await page.waitForTimeout(2500);
await shot('welcome');
await step('app menus', async () => {
  await page.locator('.v-toolbar .v-app-bar__nav-icon').click(); await shot('menu-hamburger', 400); await page.keyboard.press('Escape');
  await page.locator('.v-toolbar button:has(.mdi-help)').click(); await shot('menu-help', 400); await page.keyboard.press('Escape');
  await page.locator('.v-toolbar button:has(.mdi-account)').click(); await shot('menu-account', 400); await page.keyboard.press('Escape');
});
await step('get started menu', async () => {
  await page.getByRole('button', { name: /get started/i }).click(); await shot('new-query-menu');
  await page.getByPlaceholder('Search queries').fill('storm'); await shot('new-query-menu-search');
  await page.getByPlaceholder('Search queries').fill('');
  await page.getByText('New query', { exact: true }).click(); await page.waitForTimeout(3500);
});
await shot('kusto-query-edit', 1500);
await step('time selection', async () => {
  await page.getByRole('button', { name: /time range/i }).click(); await shot('time-range-menu');
  await page.getByText('Custom Date Range').click(); await shot('time-range-custom-date');
  await page.keyboard.press('Escape'); await page.mouse.click(900, 850); await page.waitForTimeout(500);
});
await step('time period', async () => {
  await page.getByRole('button', { name: /time range/i }).click({ force: true }); await page.waitForTimeout(500);
  await page.locator('.menuable__content__active').getByText('Custom Time Period').click(); await shot('time-range-custom-period');
  await page.locator('.menuable__content__active').getByRole('button', { name: /cancel/i }).click();
  await page.keyboard.press('Escape'); await page.mouse.click(900, 850);
});
await step('cluster combobox', async () => {
  await page.getByLabel('Cluster').first().click(); await shot('cluster-selection');
  await page.locator('.menuable__content__active').getByText('https://help.kusto.windows.net').click(); await page.waitForTimeout(300);
  await page.getByLabel('Database').first().click(); await page.locator('.menuable__content__active').getByText('Samples').click();
  await page.mouse.click(900, 850); await shot('kusto-query-edit-filled', 1000);
});
await step('query help', async () => {
  await page.locator('button:has(.mdi-help-circle-outline)').click(); await shot('query-help-dialog');
  await page.locator('.v-dialog--active').evaluate((el) => { el.scrollTop = 1200; }); await shot('query-help-dialog-scrolled');
  await page.locator('.v-dialog--active').getByRole('button', { name: /close/i }).click();
});
await step('run query', async () => {
  await page.getByRole('button', { name: /save changes & run/i }).click(); await page.waitForTimeout(3000);
});
await shot('kusto-query-results', 1000);
await step('side tree expanded', async () => {
  await page.locator('.v-navigation-drawer:has(.v-treeview)').hover(); await shot('side-tree-expanded', 800);
  await page.mouse.move(900, 500);
});
await step('grid sidebar', async () => {
  await page.locator('.ag-side-button').first().click(); await shot('grid-sidebar-columns');
  await page.locator('.ag-side-button').nth(1).click(); await shot('grid-sidebar-filters');
  await page.locator('.ag-side-button').nth(1).click();
});
await step('column filter', async () => {
  await page.locator('.ag-header-cell[col-id="State"] .ag-header-cell-menu-button').click({ force: true }); await shot('grid-column-menu'); await page.keyboard.press('Escape');
});
await step('column view', async () => {
  await page.getByLabel('Column view').click(); await page.getByLabel('Column view').fill('Triage layout'); await shot('column-view-create'); await page.keyboard.press('Escape');
});
const rightClickRow = async (i) => page.locator(`.ag-center-cols-container .ag-row[row-index="${i}"] .ag-cell[col-id="State"]`).click({ button: 'right' });
await step('context menu', async () => {
  await rightClickRow(1); await shot('grid-context-menu');
  await page.locator('.ag-menu-option:has-text("Tag Events")').hover(); await shot('grid-context-menu-tag');
  await page.locator('.ag-menu-option:has-text("Weather")').hover(); await page.waitForTimeout(300);
  await page.locator('.ag-menu-option:has-text("Storms")').hover(); await shot('grid-context-menu-pivot');
  await page.keyboard.press('Escape');
});
await step('show details', async () => {
  await rightClickRow(0); await page.locator('.ag-menu-option:has-text("Show details")').click(); await shot('detail-side-panel', 800);
  await page.locator('.v-navigation-drawer--right button').first().click().catch(() => {}); await page.keyboard.press('Escape');
});
await step('tag dialog', async () => {
  await page.locator('.ag-center-cols-container .ag-row[row-index="2"] .ag-cell').first().click();
  await page.locator('.ag-pinned-left-cols-container .ag-row[row-index="2"] .ag-checkbox-input, .ag-center-cols-container .ag-row[row-index="2"] .ag-checkbox-input').first().click({ force: true });
  await page.locator('.ag-pinned-left-cols-container .ag-row[row-index="3"] .ag-checkbox-input, .ag-center-cols-container .ag-row[row-index="3"] .ag-checkbox-input').first().click({ force: true });
  await rightClickRow(2); await page.locator('.ag-menu-option:has-text("Tag Events")').hover(); await page.waitForTimeout(300);
  await page.locator('.ag-menu-option:has-text("Customise tag events")').click(); await shot('tag-event-dialog', 800);
  await page.locator('.v-dialog--active').getByRole('button', { name: /close/i }).click();
});
await step('pivot', async () => {
  await rightClickRow(0); await page.locator('.ag-menu-option:has-text("Weather")').hover(); await page.waitForTimeout(300);
  await page.locator('.ag-menu-option:has-text("Storms")').hover(); await page.waitForTimeout(300);
  await page.locator('.ag-menu-option:has-text("Storm events for state")').click(); await page.waitForTimeout(2500);
  await shot('after-pivot');
  await page.locator('.v-navigation-drawer:has(.v-treeview)').hover(); await shot('side-tree-with-pivot', 800);
  await page.locator('.v-treeview-node__label:has-text("Storm events in")').first().click(); await page.waitForTimeout(2500);
  await page.mouse.move(900, 500);
});
await shot('template-query-results', 1000);
await step('template edit', async () => {
  await page.getByRole('button', { name: /^edit$/i }).click(); await shot('template-query-edit', 1000);
  await page.getByRole('button', { name: /cancel/i }).click();
});
await step('convert dialog', async () => {
  await page.getByRole('button', { name: /convert/i }).first().click(); await shot('template-convert-dialog'); await page.keyboard.press('Escape');
  await page.locator('.v-dialog--active').getByRole('button', { name: /cancel/i }).click().catch(() => {});
});
await step('template from menu (edit mode)', async () => {
  await page.getByRole('button', { name: /^new$/i }).first().click(); await page.waitForTimeout(300);
  await page.locator('.v-menu__content').getByText('Queries', { exact: true }).click(); await page.waitForTimeout(300);
  await page.locator('.v-menu__content').getByText('Weather', { exact: true }).click(); await page.waitForTimeout(300);
  await shot('new-menu-template-tree');
  await page.locator('.v-menu__content').getByText('Damage', { exact: true }).click(); await page.waitForTimeout(300);
  await page.locator('.v-menu__content').getByText('Damage for event type').click(); await page.waitForTimeout(2000);
  await shot('template-new-draft', 1000);
});
await step('query manager', async () => {
  await page.goto(`${B}/queries/`); await page.waitForTimeout(2000); await shot('query-manager');
  await page.getByLabel(/show deleted/i).click({ force: true }); await shot('query-manager-show-deleted');
  await page.getByRole('button', { name: /create/i }).click(); await shot('create-query-dialog', 1500);
  await page.locator('.v-dialog--active').evaluate((el) => { el.scrollTop = 900; }); await shot('create-query-dialog-scrolled', 800);
  await page.locator('.v-dialog--active').getByRole('button', { name: /close/i }).click(); await page.waitForTimeout(500);
  await page.getByText('Storm events by state').click(); await shot('edit-query-dialog', 1500);
  await page.locator('.v-dialog--active').evaluate((el) => { el.scrollTop = 900; }); await shot('edit-query-dialog-scrolled', 800);
  await page.locator('.v-dialog--active').getByRole('button', { name: /close/i }).click(); await page.waitForTimeout(500);
  await page.getByText('Damage by event type').click(); await shot('edit-query-dialog-managed', 1500);
});
await step('export', async () => {
  await page.goto(`${B}/exportimport/`); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /export/i }).click(); await shot('export-import-exported', 800);
});
await step('share', async () => {
  const p = Buffer.from(JSON.stringify({ State: 'TEXAS' })).toString('base64');
  await page.goto(`${B}/share/11111111-1111-1111-1111-111111111111?p=${p}&execute=1`); await page.waitForTimeout(3500); await shot('share-link-opened');
});
await browser.close();
