import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { useLayoutEffect, type ReactNode } from 'react';
import { theme } from './theme';

/**
 * `public/theme-init.js` sets `color-scheme` inline on `<html>` for the page shown before the
 * bundle runs. Inline style outranks the `color-scheme` that `CssBaseline` sets per scheme, so it
 * is removed once MUI's styles are in place; otherwise it would stay on the first scheme.
 */
function TakeOverFromThemeInit() {
  useLayoutEffect(() => {
    document.documentElement.style.removeProperty('color-scheme');
  }, []);
  return null;
}

/**
 * MUI theme and baseline for everything TIM renders, including the config error page. MUI holds
 * the light / dark / system mode (System, following the OS, by default), saves it in `localStorage`
 * under `tim-theme-mode` and follows changes made in other tabs. `public/theme-init.js` applies the
 * same choice before this bundle runs.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      theme={theme}
      noSsr
      disableTransitionOnChange
      modeStorageKey="tim-theme-mode"
      colorSchemeStorageKey="tim-color-scheme"
    >
      <CssBaseline enableColorScheme />
      <TakeOverFromThemeInit />
      {children}
    </ThemeProvider>
  );
}
