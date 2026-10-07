import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

/** Screenshot output directory (gitignored). */
export const SHOT_DIR = resolve(import.meta.dirname, '.screenshots');

/**
 * Screenshot into e2e/.screenshots/NN-name.png. Only writes when `E2E_SHOTS=1`, so a plain
 * `npm run e2e` leaves the repo clean. The mouse is parked away from the content so no hover
 * state leaks into the picture.
 */
export async function shot(page: Page, name: string): Promise<void> {
  if (process.env['E2E_SHOTS'] !== '1') return;
  await page.mouse.move(1400, 890);
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(SHOT_DIR, `${name}.png`) });
}
