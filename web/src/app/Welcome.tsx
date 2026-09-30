import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { NewQueryMenu } from '../features/new-query';
import { useTemplatesStore } from '../features/templates';

/** Legacy landing page (screenshot 01). */
export default function Welcome() {
  const templates = useTemplatesStore((s) => s.templates);
  const queryOptions = useTemplatesStore((s) => s.queryOptions);
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
      <NewQueryMenu templates={templates} queryOptions={queryOptions} variant="contained">
        Get Started
      </NewQueryMenu>
    </Box>
  );
}
