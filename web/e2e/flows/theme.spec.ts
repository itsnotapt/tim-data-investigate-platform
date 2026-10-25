import AxeBuilder from '@axe-core/playwright';
import type { SupportedColorScheme } from '@mui/material/styles';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { COLOR_SCHEME_ATTRIBUTE, THEME_MODE_KEY } from '../../src/app/themeKeys';
import { mockApi } from '../mocks';
import { runAdhocQuery } from '../mocks/adhoc-grid';
import { DETERMINATION_SYMBOLS_KEY } from '../../src/features/grid/determinationSymbolsKey';
import { waitForEditor } from '../mocks/editor';

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

/** The scheme stored before the page loads, as if picked in an earlier session. */
async function storeMode(page: Page, scheme: SupportedColorScheme): Promise<void> {
  await page.addInitScript(([key, mode]) => localStorage.setItem(key, mode), [
    THEME_MODE_KEY,
    scheme,
  ] as const);
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

/** Signs out from the app shell already on screen. */
async function expectAuthGate(page: Page, colours: Colours) {
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

/**
 * Waits until no finite animation or transition is running, such as a snackbar fading in.
 * Endless ones, such as a progress spinner, are not waited for.
 */
async function waitForAnimations(page: Page) {
  await page.evaluate(async () => {
    const running = () =>
      document
        .getAnimations()
        .filter(
          (a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity,
        );
    for (let pending = running(); pending.length > 0; pending = running()) {
      await Promise.all(pending.map((a) => a.finished.catch(() => undefined)));
    }
  });
}

/**
 * axe colour contrast (WCAG 2 AA) on the current page once its animations have ended, so a
 * partly faded-in element is measured at its final colours; "incomplete" results don't fail.
 * Without the wait, a snackbar fading in on the light page fails axe.
 */
async function expectColourContrast(page: Page) {
  await waitForAnimations(page);
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
 * Contrast of each tagged row's text (4.5:1) and symbol (3:1, non-text) against the row's fill.
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

// The results grid and config error page in each scheme are checked in the colour contrast sweep.
test.describe('with dark mode stored', () => {
  test.beforeEach(async ({ page }) => storeMode(page, 'dark'));

  test('the app shell and the auth gate are dark', async ({ page }) => {
    await expectAppShell(page, DARK);
    await expectScheme(page, 'dark', DARK);
    await expectAuthGate(page, DARK);
    await expectScheme(page, 'dark', DARK);
  });

  test('the KQL editor is dark', async ({ page }) => {
    await expectKqlEditor(page, DARK);
  });
});

test.describe('with nothing stored', () => {
  test('the KQL editor is on the light editor background', async ({ page }) => {
    await expectKqlEditor(page, LIGHT);
  });
});

test.describe('with nothing stored on a dark OS', () => {
  test.beforeEach(async ({ page }) => page.emulateMedia({ colorScheme: 'dark' }));

  test('the app shell follows the OS, including a live change, and so does the auth gate', async ({
    page,
  }) => {
    await expectAppShell(page, DARK);
    await expectScheme(page, 'dark', DARK);
    await page.emulateMedia({ colorScheme: 'light' });
    await expectScheme(page, 'light', LIGHT);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectScheme(page, 'dark', DARK);
    await expectAuthGate(page, DARK);
    await expectScheme(page, 'dark', DARK);
  });

  test('the config error page is dark', async ({ page }) => {
    await expectConfigError(page);
    await expectScheme(page, 'dark', DARK);
  });
});

/** Settings › Appearance › `choice`; picking closes both menus. */
async function pickAppearance(page: Page, choice: 'Light' | 'Dark' | 'System') {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Appearance' }).click();
  await page
    .getByRole('menu', { name: 'Appearance' })
    .getByRole('menuitemradio', { name: choice })
    .click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/**
 * Records every value the scheme attribute takes on `<html>` from the very start of each load, and
 * its value at DOM-ready, in `window.schemeLog`. It watches the whole document.
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

test.describe('Settings › Appearance', () => {
  test('Dark survives a reload with no light flash', async ({ page }) => {
    await expectAppShell(page, LIGHT);
    await pickAppearance(page, 'Dark');
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

  test('a second page in the same browser follows the choice', async ({ page, context }) => {
    await expectAppShell(page, LIGHT);
    const other = await context.newPage();
    await mockApi(other);
    await expectAppShell(other, LIGHT);

    await pickAppearance(page, 'Dark');
    await expectScheme(other, 'dark', DARK);
    await pickAppearance(page, 'Light');
    await expectScheme(other, 'light', LIGHT);
  });

  test('System goes back to following the OS', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await storeMode(page, 'dark');
    await expectAppShell(page, DARK);
    await pickAppearance(page, 'Light');
    await expectScheme(page, 'light', LIGHT);
    await pickAppearance(page, 'System');
    await expectScheme(page, 'dark', DARK);
  });
});

const THEME_CHOICE = { light: 'Light', dark: 'Dark' } as const;
const COLOURS = { light: LIGHT, dark: DARK } as const;
const GRID_COLOURS = { light: LIGHT_GRID, dark: DARK_GRID } as const;

/**
 * The sweep: axe colour contrast on every main screen in both schemes. The scheme is picked from
 * Settings › Appearance on an OS set to the other one; the config error page, which has no Settings
 * menu, stores it instead. A walk moves between screens through hash routes, which stay on the same
 * document, so the app isn't loaded again for each screen.
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
      await pickAppearance(page, THEME_CHOICE[scheme]);
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
      await page.addInitScript((key) => localStorage.setItem(key, 'on'), DETERMINATION_SYMBOLS_KEY);
      await pickScheme(page);
      await expectResultsGrid(page, GRID_COLOURS[scheme]);
      await expectScheme(page, scheme, COLOURS[scheme]);
      // Rows 0 / 5 / 10 carry the three determinations: their fills and symbols are on screen.
      for (const name of ['Malicious', 'Suspicious', 'Benign']) {
        await expect(page.getByRole('img', { name }).first()).toBeVisible();
      }
      await expectContrastInScheme(page);
      await expectTaggedRowContrast(page);
    });

    test('the config error page', async ({ page }) => {
      await storeMode(page, scheme);
      await expectConfigError(page);
      await expectScheme(page, scheme, COLOURS[scheme]);
      await expectContrastInScheme(page);
    });
  });
}
