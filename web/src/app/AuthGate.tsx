import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Link from '@mui/material/Link';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { useBootstrap, type BootstrapSteps } from './useBootstrap';
import { WhoAreYou } from './WhoAreYou';

/**
 * Renders the routes only when signed in and bootstrapped (instance, column views, tabs);
 * otherwise the sign-in ("Who are you?" with stub sign-in) / loading / error states.
 */
export function AuthGate({ children, steps }: { children: ReactNode; steps?: BootstrapSteps }) {
  const { status, error, login, retry } = useBootstrap(steps);
  const { signInAs } = useAuth();

  switch (status) {
    case 'loaded':
      return <>{children}</>;
    case 'signedOut':
      if (signInAs) return <WhoAreYou signInAs={signInAs} />;
      return (
        <Container sx={{ mt: 2 }}>
          <Alert severity="info" variant="outlined">
            You must{' '}
            <Link
              component="button"
              type="button"
              sx={{ verticalAlign: 'baseline' }}
              onClick={() => void login()}
            >
              sign-in
            </Link>{' '}
            first.
          </Alert>
        </Container>
      );
    case 'error':
      // The failure is shown with an explicit Retry that starts a fresh sign-in.
      return (
        <Container sx={{ mt: 2 }}>
          <Alert
            severity="error"
            variant="outlined"
            action={
              <Button color="inherit" size="small" onClick={retry}>
                Retry
              </Button>
            }
          >
            {error?.message ?? 'Loading failed.'}
          </Alert>
        </Container>
      );
    case 'loading':
      return (
        <Container sx={{ mt: 2 }}>
          <Alert
            severity="info"
            variant="outlined"
            icon={<CircularProgress size={20} aria-label="Loading" />}
          >
            Authenticating and loading...
          </Alert>
        </Container>
      );
  }
}
