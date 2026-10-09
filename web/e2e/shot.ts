import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { COLOR_SCHEME_ATTRIBUTE, THEME_MODE_KEY } from '../src/app/themeKeys';

/** Screenshot output directory (gitignored). */
export const SHOT_DIR = resolve(import.meta.dirname, '.screenshots');

/**
 * Switches the page to `mode` the way a change in another tab does: a `storage` event for
 * `THEME_MODE_KEY`, which MUI applies at once (and saves). Returns the stored value before.
 */
async function switchMode(page: Page, mode: string): Promise<string | null> {
  return page.evaluate(
    ([key, next]) => {
      const before = localStorage.getItem(key);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: next }));
      return before;
    },
    [THEME_MODE_KEY, mode] as const,
  );
}

/** Takes the light picture, then a dark copy as `<name>-dark.png`, then restores the choice. */
async function lightAndDark(page: Page, name: string, settle: number): Promise<void> {
  await page.screenshot({ path: resolve(SHOT_DIR, `${name}.png`) });
  const before = await switchMode(page, 'dark');
  await page.locator(`html[${COLOR_SCHEME_ATTRIBUTE}="dark"]`).waitFor({ state: 'attached' });
  await page.waitForTimeout(settle);
  await page.screenshot({ path: resolve(SHOT_DIR, `${name}-dark.png`) });
  await switchMode(page, before ?? 'system');
  await page.evaluate(
    ([key, value]) =>
      value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value),
    [THEME_MODE_KEY, before] as const,
  );
  await page.waitForTimeout(settle);
}

/**
 * Screenshot into e2e/.screenshots/NN-name.png, plus a dark copy NN-name-dark.png for a person to
 * review. Only writes when `E2E_SHOTS=1`, so a plain `npm run e2e` leaves the repo clean. The
 * mouse is parked away from the content so no hover state leaks into the picture.
 */
export async function shot(page: Page, name: string): Promise<void> {
  if (process.env['E2E_SHOTS'] !== '1') return;
  await page.mouse.move(1400, 890);
  await page.waitForTimeout(400);
  await lightAndDark(page, name, 400);
}

/**
 * Like `shot()` but leaves the mouse where it is: for states that only exist while hovering
 * (the expanded side tree). Same directory, dark copy and `E2E_SHOTS` gate as `shot()`.
 */
export async function shotHovering(page: Page, name: string): Promise<void> {
  if (process.env['E2E_SHOTS'] !== '1') return;
  await page.waitForTimeout(500);
  await lightAndDark(page, name, 500);
}
