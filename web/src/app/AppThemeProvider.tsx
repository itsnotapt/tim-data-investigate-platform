import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, type StorageManager } from '@mui/material/styles';
import { useLayoutEffect, type ReactNode } from 'react';
import { theme } from './theme';
import { THEME_MODE_KEY, type ThemeMode } from './themeKeys';

const THEME_MODES: readonly string[] = ['light', 'dark', 'system'] satisfies ThemeMode[];

/** `localStorage` for MUI, except that a stored mode MUI doesn't know reads as the default (System). */
const storageManager: StorageManager = ({ key }) => ({
  get(defaultValue: unknown) {
    let value: string | null = null;
    try {
      value = localStorage.getItem(key);
    } catch {
      // Storage unavailable.
    }
    if (!value || (key === THEME_MODE_KEY && !THEME_MODES.includes(value))) return defaultValue;
    return value;
  },
  set(value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable.
    }
  },
  subscribe(handler: (value: string | null) => void) {
    const listener = (event: StorageEvent) => {
      if (event.key === key) handler(event.newValue);
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  },
});

/**
 * Removes the inline `color-scheme` that `public/theme-init.js` sets, leaving `CssBaseline`'s.
 */
function TakeOverFromThemeInit() {
  useLayoutEffect(() => {
    document.documentElement.style.removeProperty('color-scheme');
  }, []);
  return null;
}

/**
 * MUI theme and baseline for everything TIM renders, including the config error page. MUI holds
 * the light / dark / system mode (System by default), saves it in `localStorage` and follows
 * changes made in other tabs.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      theme={theme}
      noSsr
      disableTransitionOnChange
      modeStorageKey={THEME_MODE_KEY}
      colorSchemeStorageKey="tim-color-scheme"
      storageManager={storageManager}
    >
      <CssBaseline enableColorScheme />
      <TakeOverFromThemeInit />
      {children}
    </ThemeProvider>
  );
}
