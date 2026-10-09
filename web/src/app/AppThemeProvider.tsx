import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { theme } from './theme';

/**
 * MUI theme and baseline for everything TIM renders, including the config error page. MUI holds
 * the light / dark / system mode and saves it in `localStorage` under `tim-theme-mode`.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    // defaultMode="light" is temporary: it keeps the app light until every part follows the
    // colour scheme and Settings offers the choice; then the default becomes System.
    <ThemeProvider
      theme={theme}
      noSsr
      disableTransitionOnChange
      modeStorageKey="tim-theme-mode"
      colorSchemeStorageKey="tim-color-scheme"
      defaultMode="light"
    >
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
}
