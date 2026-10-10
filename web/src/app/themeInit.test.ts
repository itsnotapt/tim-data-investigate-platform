import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SupportedColorScheme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setPrefersColorScheme } from '../test/matchMedia';
import { COLOR_SCHEME_ATTRIBUTE, THEME_MODE_KEY } from './themeKeys';

// public/theme-init.js runs as a classic script in <head>, before the module bundle.
const source = readFileSync(resolve(import.meta.dirname, '../../public/theme-init.js'), 'utf8');
const html = document.documentElement;

function runThemeInit(stored: string | null, os: SupportedColorScheme) {
  if (stored !== null) localStorage.setItem(THEME_MODE_KEY, stored);
  setPrefersColorScheme(os);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the shipped script as is
  (new Function(source) as () => void)();
  return { attr: html.getAttribute(COLOR_SCHEME_ATTRIBUTE), colorScheme: html.style.colorScheme };
}

describe('public/theme-init.js', () => {
  afterEach(() => {
    html.removeAttribute(COLOR_SCHEME_ATTRIBUTE);
    html.style.colorScheme = '';
    vi.restoreAllMocks();
  });

  it.each([
    { stored: null, os: 'light', expected: 'light' },
    { stored: null, os: 'dark', expected: 'dark' },
    { stored: 'light', os: 'dark', expected: 'light' },
    { stored: 'dark', os: 'light', expected: 'dark' },
    { stored: 'system', os: 'dark', expected: 'dark' },
    { stored: 'system', os: 'light', expected: 'light' },
    { stored: 'purple', os: 'dark', expected: 'dark' },
    { stored: 'purple', os: 'light', expected: 'light' },
  ] as const)('stored $stored on a $os OS: $expected', ({ stored, os, expected }) => {
    expect(runThemeInit(stored, os)).toEqual({ attr: expected, colorScheme: expected });
  });

  it('falls back to the OS when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(runThemeInit(null, 'dark')).toEqual({ attr: 'dark', colorScheme: 'dark' });
  });
});
