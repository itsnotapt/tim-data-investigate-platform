import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Link from '@mui/material/Link';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';

/** Renders the routes only when signed in; otherwise the legacy sign-in / loading / error states. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, error, login } = useAuth();

  switch (status) {
    case 'signedIn':
      return <>{children}</>;
    case 'signedOut':
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
      // BUG-22: the failure is shown with an explicit Retry that starts a fresh sign-in.
      return (
        <Container sx={{ mt: 2 }}>
          <Alert
            severity="error"
            variant="outlined"
            action={
              <Button color="inherit" size="small" onClick={() => void login()}>
                Retry
              </Button>
            }
          >
            {error?.message ?? 'Sign-in failed.'}
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
            Authenticating and loading queries...
          </Alert>
        </Container>
      );
  }
}
