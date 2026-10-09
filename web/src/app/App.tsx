import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { RouterProvider } from 'react-router/dom';
import { SnackbarHost } from '../components/SnackbarHost';
import { AuthProvider, getAuthClient, type AuthClient } from '../lib/auth';
import { router } from './router';
import { useMemo } from 'react';
import { buildTheme, PALETTES, usePaletteStore } from './palettes.prototype';

/** `authClient` is injectable for tests; the app uses the config/stub-selected client. */
export function App({ authClient }: { authClient?: AuthClient } = {}) {
  const variant = usePaletteStore((s) => s.variant);
  const theme = useMemo(() => buildTheme(PALETTES[variant]), [variant]);
  return (
    <ThemeProvider theme={theme} noSsr>
      <CssBaseline />
      <SnackbarHost>
        <AuthProvider client={authClient ?? getAuthClient()}>
          <RouterProvider router={router} />
        </AuthProvider>
      </SnackbarHost>
    </ThemeProvider>
  );
}
