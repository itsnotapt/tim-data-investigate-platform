import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

/** The analysts the demo offers one-click sign-in as. */
const DEMO_ANALYSTS = ['alice@demo.example', 'bob@demo.example'];

/** Stub sign-in (ADR-0026): the analyst picks a demo analyst or types a name or email. */
export function WhoAreYou({ signInAs }: { signInAs: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  return (
    <Container maxWidth="xs" sx={{ mt: 4 }}>
      <Stack spacing={2}>
        <Typography variant="h5" component="h2">
          Who are you?
        </Typography>
        <Typography color="text.secondary">
          This TIM signs you in by name, without an account. Pick a demo analyst or type your own
          name or email.
        </Typography>
        {DEMO_ANALYSTS.map((analyst) => (
          <Button key={analyst} variant="outlined" onClick={() => void signInAs(analyst)}>
            {analyst}
          </Button>
        ))}
        <Divider>or</Divider>
        <Stack
          component="form"
          direction="row"
          spacing={1}
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed) void signInAs(trimmed);
          }}
        >
          <TextField
            label="Name or email"
            size="small"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" variant="contained" disabled={!trimmed}>
            Sign in
          </Button>
        </Stack>
      </Stack>
    </Container>
  );
}
