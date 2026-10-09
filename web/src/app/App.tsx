import { RouterProvider } from 'react-router/dom';
import { SnackbarHost } from '../components/SnackbarHost';
import { AuthProvider, getAuthClient, type AuthClient } from '../lib/auth';
import { router } from './router';

/**
 * `authClient` is injectable for tests; the app uses the config/stub-selected client.
 * Renders inside `AppThemeProvider` (main.tsx).
 */
export function App({ authClient }: { authClient?: AuthClient } = {}) {
  return (
    <SnackbarHost>
      <AuthProvider client={authClient ?? getAuthClient()}>
        <RouterProvider router={router} />
      </AuthProvider>
    </SnackbarHost>
  );
}
