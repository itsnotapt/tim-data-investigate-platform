import AxeBuilder from '@axe-core/playwright';
import type { SupportedColorScheme } from '@mui/material/styles';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { COLOR_SCHEME_ATTRIBUTE, THEME_MODE_KEY } from '../../src/app/themeKeys';
import { mockApi } from '../mocks';
import { runAdhocQuery } from '../mocks/adhoc-grid';
import { waitForEditor } from '../mocks/editor';
import {
  openRunTemplateTab,
  shareParams,
  STORM_UUID,
  templateStoreHandlers,
} from '../mocks/templates';

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

/** Dark stored before the page loads, as if picked in an earlier session. */
async function storeDarkMode(page: Page): Promise<void> {
  await page.addInitScript((key) => localStorage.setItem(key, 'dark'), THEME_MODE_KEY);
}

/** The deployment serves a runtime config without `auth`, so main.tsx renders the config error page. */
async function serveConfigWithoutAuth(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === '/config.js',
    (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: "window.appConfig = { tagCluster: 'https://help.kusto.windows.net' };",
      }),
  );
}

async function expectScheme(page: Page, scheme: SupportedColorScheme, colours: Colours) {
  const html = page.locator('html');
  await expect(html).toHaveAttribute(COLOR_SCHEME_ATTRIBUTE, scheme);
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
  await serveConfigWithoutAuth(page);
  await page.goto('/');
  await expect(page.getByText('TIM cannot start: configuration error')).toBeVisible();
  await expect(page.getByText('auth.clientId: missing (required)')).toBeVisible();
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

/** WCAG 2 contrast ratio of two computed `rgb(…)` colours. */
function contrastRatio(a: string, b: string): number {
  const luminance = (colour: string) => {
    const [red, green, blue] = (colour.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((v) => {
      const c = Number(v) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/**
 * axe reports every results grid body cell as "incomplete" (AG Grid's layered row DOM hides the
 * background from it), so the text and the symbol of each tagged row are checked against the
 * row's fill here: 4.5:1 for text, 3:1 for the symbol (non-text).
 */
async function expectTaggedRowContrast(page: Page) {
  for (const [index, name] of [
    [0, 'Malicious'],
    [5, 'Suspicious'],
    [10, 'Benign'],
  ] as const) {
    const row = page.locator(`.ag-row[row-index="${index}"]`);
    const fill = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
    const text = await row
      .locator('.ag-cell[col-id="State"]')
      .evaluate((el) => getComputedStyle(el).color);
    const symbol = await row
      .getByRole('img', { name })
      .evaluate((el) => getComputedStyle(el).color);
    expect(contrastRatio(text, fill), `${name} row text on ${fill}`).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(symbol, fill), `${name} symbol on ${fill}`).toBeGreaterThanOrEqual(3);
  }
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

  test('the app shell follows the OS, including a live change', async ({ page }) => {
    await expectAppShell(page, DARK);
    await expectScheme(page, 'dark', DARK);
    await page.emulateMedia({ colorScheme: 'light' });
    await expectScheme(page, 'light', LIGHT);
    await page.emulateMedia({ colorScheme: 'dark' });
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
});

/** Settings › Theme › `choice`; picking closes both menus. */
async function pickTheme(page: Page, choice: 'Light' | 'Dark' | 'System') {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Theme' }).click();
  await page
    .getByRole('menu', { name: 'Theme' })
    .getByRole('menuitemradio', { name: choice })
    .click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/**
 * Records every value the scheme attribute takes on `<html>` from the very start of each load, and
 * its value at DOM-ready, in `window.schemeLog`. Init scripts run before `<html>` exists, so this
 * watches the whole document.
 */
async function logSchemeChanges(page: Page): Promise<void> {
  await page.addInitScript((attribute) => {
    const log = { values: [] as (string | null)[], atDomReady: null as string | null };
    Object.assign(window, { schemeLog: log });
    const current = () => document.documentElement?.getAttribute(attribute) ?? null;
    const record = () => {
      if (log.values.at(-1) !== current()) log.values.push(current());
    };
    record();
    new MutationObserver(record).observe(document, {
      childList: true,
      subtree: true,
      attributeFilter: [attribute],
    });
    document.addEventListener('DOMContentLoaded', () => {
      log.atDomReady = current();
    });
  }, COLOR_SCHEME_ATTRIBUTE);
}

const schemeLog = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { schemeLog: { values: string[]; atDomReady: string } }).schemeLog,
  );

test.describe('Settings › Theme', () => {
  test('Dark survives a reload with no light flash', async ({ page }) => {
    await expectAppShell(page, LIGHT);
    await pickTheme(page, 'Dark');
    await expectScheme(page, 'dark', DARK);

    await logSchemeChanges(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome to TIM' })).toBeVisible();
    await expectScheme(page, 'dark', DARK);
    const log = await schemeLog(page);
    expect(log.atDomReady).toBe('dark');
    // Unset until theme-init.js runs in <head> (nothing painted yet), then only dark.
    expect(log.values).toEqual([null, 'dark']);
  });

  test('theme-init.js applies the stored choice before the bundle runs', async ({ page }) => {
    await storeDarkMode(page);
    await page.route('**/src/app/main.tsx*', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: '' }),
    );
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute(COLOR_SCHEME_ATTRIBUTE, 'dark');
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  });

  test('a second page in the same browser follows the choice', async ({ page, context }) => {
    await expectAppShell(page, LIGHT);
    const other = await context.newPage();
    await mockApi(other, { handlers: store.handlers });
    await expectAppShell(other, LIGHT);

    await pickTheme(page, 'Dark');
    await expectScheme(other, 'dark', DARK);
    await pickTheme(page, 'Light');
    await expectScheme(other, 'light', LIGHT);
  });

  test('System goes back to following the OS', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await storeDarkMode(page);
    await expectAppShell(page, DARK);
    await pickTheme(page, 'Light');
    await expectScheme(page, 'light', LIGHT);
    await pickTheme(page, 'System');
    await expectScheme(page, 'dark', DARK);
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`colour contrast on a ${scheme} OS`, () => {
    test.beforeEach(async ({ page }) => page.emulateMedia({ colorScheme: scheme }));

    test('home', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Welcome to TIM' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute(COLOR_SCHEME_ATTRIBUTE, scheme);
      await expectColourContrast(page);
    });

    test('Query Manager', async ({ page }) => {
      await page.goto('/#/queries');
      await expect(page.getByRole('heading', { name: 'Query Manager' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Storm events by state' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute(COLOR_SCHEME_ATTRIBUTE, scheme);
      await expectColourContrast(page);
    });
  });
}

/** The scheme stored before the page loads, for the config error page (it has no Settings menu). */
async function storeMode(page: Page, scheme: SupportedColorScheme): Promise<void> {
  await page.addInitScript(([key, mode]) => localStorage.setItem(key, mode), [
    THEME_MODE_KEY,
    scheme,
  ] as const);
}

const THEME_CHOICE = { light: 'Light', dark: 'Dark' } as const;

/**
 * The sweep: axe colour contrast on every main screen in both schemes. The scheme is picked from
 * Settings › Theme on an OS set to the other one, so the pick is what decides it.
 */
for (const scheme of ['light', 'dark'] as const) {
  test.describe(`colour contrast sweep in ${scheme}`, () => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

    test.beforeEach(async ({ page }) =>
      page.emulateMedia({ colorScheme: scheme === 'dark' ? 'light' : 'dark' }),
    );

    /** Picks the scheme on the home screen; the choice is saved, so later loads keep it. */
    async function pickScheme(page: Page) {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Welcome to TIM' })).toBeVisible();
      await pickTheme(page, THEME_CHOICE[scheme]);
      await expect(page.locator('html')).toHaveAttribute(COLOR_SCHEME_ATTRIBUTE, scheme);
    }

    async function expectContrastInScheme(page: Page) {
      await expect(page.locator('html')).toHaveAttribute(COLOR_SCHEME_ATTRIBUTE, scheme);
      await expectColourContrast(page);
    }

    test('home', async ({ page }) => {
      await pickScheme(page);
      await expectContrastInScheme(page);
    });

    test('results with tagged rows', async ({ page }) => {
      await pickScheme(page);
      await runAdhocQuery(page);
      // Rows 0 / 5 / 10 carry the three determinations: their fills and symbols are on screen.
      for (const name of ['Malicious', 'Suspicious', 'Benign']) {
        await expect(page.getByRole('img', { name }).first()).toBeVisible();
      }
      await expectContrastInScheme(page);
      await expectTaggedRowContrast(page);
    });

    test('Query Manager', async ({ page }) => {
      await pickScheme(page);
      await page.goto('/#/queries');
      await expect(page.getByRole('heading', { name: 'Query Manager' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Storm events by state' })).toBeVisible();
      await expectContrastInScheme(page);
    });

    test('a saved view', async ({ page }) => {
      await pickScheme(page);
      await openRunTemplateTab(page);
      // Reloading the tab's own URL opens the saved view, not the share link.
      await page.reload();
      await expect(page).toHaveURL(/#\/view\//);
      await expect(page.locator('.ag-row[row-index="1"] .ag-cell[col-id="State"]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Share Link' })).toBeVisible();
      await expectContrastInScheme(page);
    });

    test('a shared query', async ({ page }) => {
      await pickScheme(page);
      await page.goto(`/#/share/${STORM_UUID}?p=${shareParams({ State: 'TEXAS' })}&execute=0`);
      await expect(page.getByRole('button', { name: 'Save & Run' })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'State' })).toHaveValue('TEXAS');
      await expectContrastInScheme(page);
    });

    test('a shared query link with an error', async ({ page }) => {
      await pickScheme(page);
      await page.goto(`/#/share/${STORM_UUID}`);
      await expect(page.getByText('Parameters are missing.')).toBeVisible();
      await expectContrastInScheme(page);
    });

    test('Export / Import', async ({ page }) => {
      await pickScheme(page);
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('menuitem', { name: 'Export / Import' }).click();
      await expect(page).toHaveURL(/#\/exportimport/);
      await page.getByRole('button', { name: 'Export' }).click();
      await expect(
        page.getByText('All settings have been exported and saved to your clipboard.'),
      ).toBeVisible();
      await expectContrastInScheme(page);
    });

    test('the config error page', async ({ page }) => {
      await storeMode(page, scheme);
      await expectConfigError(page);
      await expectContrastInScheme(page);
    });
  });
}
