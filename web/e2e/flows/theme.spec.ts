import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { runAdhocQuery } from '../mocks/adhoc-grid';
import { waitForEditor } from '../mocks/editor';
import { templateStoreHandlers } from '../mocks/templates';

// Computed colours of the light and dark palettes (web/src/app/theme.ts).
const LIGHT = {
  background: 'rgb(255, 255, 255)',
  paper: 'rgb(255, 255, 255)',
  text: 'rgb(33, 33, 33)',
  primary: 'rgb(25, 118, 210)',
  editor: 'rgb(255, 255, 255)',
};
const DARK = {
  background: 'rgb(18, 18, 18)',
  paper: 'rgb(30, 30, 30)',
  text: 'rgb(224, 224, 224)',
  primary: 'rgb(144, 202, 249)',
  editor: 'rgb(30, 30, 30)',
};
type Colours = typeof LIGHT;

// Computed results grid colours (`grid`, `divider`, `determination`, `stripe` in theme.ts).
const LIGHT_GRID = {
  paper: LIGHT.paper,
  text: LIGHT.text,
  header: 'rgb(245, 247, 247)',
  oddRow: 'rgb(252, 253, 254)',
  border: 'rgb(224, 224, 224)',
  malicious: { fill: 'rgb(254, 202, 202)', stripe: 'rgb(220, 38, 38)' },
  suspicious: { fill: 'rgb(253, 230, 138)', stripe: 'rgb(217, 119, 6)' },
  benign: { fill: 'rgb(187, 247, 208)', stripe: 'rgb(22, 163, 74)' },
};
const DARK_GRID = {
  paper: DARK.paper,
  text: DARK.text,
  header: 'rgb(38, 38, 38)',
  oddRow: 'rgb(35, 35, 35)',
  border: 'rgb(51, 51, 51)',
  malicious: { fill: 'rgb(127, 29, 29)', stripe: 'rgb(248, 113, 113)' },
  suspicious: { fill: 'rgb(113, 63, 18)', stripe: 'rgb(251, 191, 36)' },
  benign: { fill: 'rgb(20, 83, 45)', stripe: 'rgb(74, 222, 128)' },
};
type GridColours = typeof LIGHT_GRID;

/** Dark can't be picked in the UI yet: a stored mode overrides the light default. */
async function storeDarkMode(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('tim-theme-mode', 'dark'));
}

/** The dev stub auth throws when created, so main.tsx renders the config error page. */
async function failAuthSetup(page: Page): Promise<void> {
  await page.route('**/src/lib/auth/devStubAuth.ts*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: [
        'export const DEV_ACCOUNT = {};',
        "export const DEV_TOKEN = '';",
        "export function createDevStubAuth() { throw new Error('auth.clientId is required'); }",
      ].join('\n'),
    }),
  );
}

async function expectScheme(page: Page, scheme: 'light' | 'dark', colours: Colours) {
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-ag-theme-mode', scheme);
  await expect(html).toHaveCSS('color-scheme', scheme);
  await expect(page.locator('body')).toHaveCSS('background-color', colours.background);
  await expect(page.locator('body')).toHaveCSS('color', colours.text);
}

async function expectAppShell(page: Page, colours: Colours) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to TIM' })).toBeVisible();
  const appBar = page.locator('header');
  await expect(appBar).toHaveCSS('background-color', colours.paper);
}

async function expectAuthGate(page: Page, colours: Colours) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const signIn = page.getByRole('button', { name: 'sign-in' });
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveCSS('color', colours.primary);
}

async function expectConfigError(page: Page) {
  await failAuthSetup(page);
  await page.goto('/');
  await expect(page.getByText('TIM cannot start: configuration error')).toBeVisible();
  await expect(page.getByText('auth.clientId is required')).toBeVisible();
}

/**
 * The ad hoc results grid (e2e/mocks/data.ts): rows 0 / 5 / 10 are malicious / suspicious / benign,
 * rows 1 and 2 are untagged. Row 5 is odd, so its fill also covers odd rows.
 */
async function expectResultsGrid(page: Page, colours: GridColours) {
  await runAdhocQuery(page);
  const grid = page.locator('.ag-root-wrapper');
  await expect(grid).toHaveCSS('background-color', colours.paper);
  await expect(grid).toHaveCSS('border-top-color', colours.border);
  const header = page.locator('.ag-header');
  await expect(header).toHaveCSS('border-bottom-color', colours.border);
  await expect(header.locator('.ag-grid-scrolling-cells')).toHaveCSS(
    'background-color',
    colours.header,
  );

  // AG Grid 36 draws one element per row; its pinned cells sit in a wrapper inside the row.
  const row = (index: number) => page.locator(`.ag-row[row-index="${index}"]`);
  await expect(row(1)).toHaveCSS('background-color', colours.oddRow);
  await expect(row(2)).toHaveCSS('background-color', colours.paper);
  await expect(row(2).locator('.ag-cell[col-id="State"]')).toHaveCSS('color', colours.text);

  for (const [index, determination] of [
    [0, colours.malicious],
    [5, colours.suspicious],
    [10, colours.benign],
  ] as const) {
    await expect(row(index)).toHaveCSS('background-color', determination.fill);
    await expect.poll(() => fillerColour(row(index))).toBe(determination.fill);
    await expect
      .poll(() => paintedColour(row(index).locator('.ag-grid-pinned-left-cells')))
      .toBe(determination.fill);
    await expect(row(index).locator('.ag-cell.ag-column-first')).toHaveCSS(
      'box-shadow',
      `${determination.stripe} 5px 0px 0px 0px inset`,
    );
  }
}

/** The row's `::after` fills the space right of the last column. */
async function fillerColour(row: Locator): Promise<string> {
  return row.evaluate((el) => getComputedStyle(el, '::after').backgroundColor);
}

/** The colour a background shows: AG Grid paints pinned cells with a one-colour gradient image. */
async function paintedColour(element: Locator): Promise<string> {
  return element.evaluate((el) => {
    const style = getComputedStyle(el);
    const gradient = /^linear-gradient\((rgba?\([^)]*\)), \1\)$/.exec(style.backgroundImage);
    return gradient?.[1] ?? style.backgroundColor;
  });
}

/** axe colour contrast (WCAG 2 AA) on the current page; "incomplete" results don't fail. */
async function expectColourContrast(page: Page) {
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(results.violations).toEqual([]);
}

const store = templateStoreHandlers();
test.use({ apiOptions: { handlers: store.handlers } });
test.beforeEach(() => store.reset());

/** The KQL editor of a new ad hoc query. */
async function expectKqlEditor(page: Page, colours: Colours) {
  await page.goto('/');
  await page.getByRole('button', { name: /get started/i }).click();
  await page.getByRole('menuitem', { name: 'New query' }).click();
  await waitForEditor(page);
  await expect(page.locator('.monaco-editor').first()).toHaveCSS(
    'background-color',
    colours.editor,
  );
}

/** The Query Manager edit dialog has YAML and plain text editors only, so no Kusto is loaded. */
async function expectYamlEditor(page: Page, colours: Colours) {
  await page.goto('/#/queries');
  await page.getByRole('button', { name: 'Storm events by state' }).click();
  const params = page.getByRole('dialog', { name: 'Edit Query' }).locator('.monaco-editor').first();
  await waitForEditor(page, params);
  await expect(params).toHaveCSS('background-color', colours.editor);
}

test.describe('with dark mode stored', () => {
  test.beforeEach(async ({ page }) => storeDarkMode(page));

  test('the app shell is dark', async ({ page }) => {
    await expectAppShell(page, DARK);
    await expectScheme(page, 'dark', DARK);
  });

  test('the auth gate is dark', async ({ page }) => {
    await expectAuthGate(page, DARK);
    await expectScheme(page, 'dark', DARK);
  });

  test('the config error page is dark', async ({ page }) => {
    await expectConfigError(page);
    await expectScheme(page, 'dark', DARK);
  });

  test('the results grid is dark', async ({ page }) => {
    await expectResultsGrid(page, DARK_GRID);
    await expectScheme(page, 'dark', DARK);
  });

  test('the results screen with tagged rows meets colour contrast', async ({ page }) => {
    await expectResultsGrid(page, DARK_GRID);
    await expectColourContrast(page);
  });

  test('the KQL editor is dark', async ({ page }) => {
    await expectKqlEditor(page, DARK);
  });

  test('a YAML editor opened before any KQL editor is dark', async ({ page }) => {
    await expectYamlEditor(page, DARK);
  });
});

test.describe('with nothing stored', () => {
  test('the KQL editor is on the light editor background', async ({ page }) => {
    await expectKqlEditor(page, LIGHT);
  });

  test('a YAML editor is on the light editor background', async ({ page }) => {
    await expectYamlEditor(page, LIGHT);
  });

  test('the results grid has the light palette', async ({ page }) => {
    await expectResultsGrid(page, LIGHT_GRID);
  });

  test('the results screen with tagged rows meets colour contrast', async ({ page }) => {
    await expectResultsGrid(page, LIGHT_GRID);
    await expectColourContrast(page);
  });
});

test.describe('with nothing stored on a dark OS', () => {
  test.beforeEach(async ({ page }) => page.emulateMedia({ colorScheme: 'dark' }));

  test('the app shell stays light', async ({ page }) => {
    await expectAppShell(page, LIGHT);
    await expectScheme(page, 'light', LIGHT);
  });

  test('the auth gate stays light', async ({ page }) => {
    await expectAuthGate(page, LIGHT);
    await expectScheme(page, 'light', LIGHT);
  });

  test('the config error page stays light', async ({ page }) => {
    await expectConfigError(page);
    await expectScheme(page, 'light', LIGHT);
  });
});
