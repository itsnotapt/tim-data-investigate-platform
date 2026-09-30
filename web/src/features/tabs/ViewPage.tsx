import Typography from '@mui/material/Typography';
import { useParams } from 'react-router';

export default function ViewPage() {
  const { uuid } = useParams();
  return (
    <>
      <Typography variant="h5" component="h2" gutterBottom>
        View
      </Typography>
      <Typography color="text.secondary">{`Display component: ${uuid ?? ''}`}</Typography>
    </>
  );
}
