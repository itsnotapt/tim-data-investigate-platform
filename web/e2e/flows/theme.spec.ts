import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
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
