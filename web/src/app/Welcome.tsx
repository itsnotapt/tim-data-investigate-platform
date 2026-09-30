import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

/** Legacy landing page (screenshot 01). */
export default function Welcome() {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        minHeight: '60vh',
      }}
    >
      <Typography variant="h4" component="h2" gutterBottom>
        Welcome to TIM
      </Typography>
      <Typography sx={{ mb: 2 }}>The triage and investigation experience.</Typography>
      {/* TODO(P4): replace with NewQueryButton (New query menu). */}
      <Button variant="contained" color="inherit" disabled>
        Get Started
      </Button>
    </Box>
  );
}
