import { Alert, AlertTitle, Container } from '@mui/material';

export function ConfigError({ message }: { message: string }) {
  return (
    <Container maxWidth="md" sx={{ mt: 6 }}>
      <Alert severity="error">
        <AlertTitle>TIM cannot start: configuration error</AlertTitle>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message}</pre>
      </Alert>
    </Container>
  );
}
