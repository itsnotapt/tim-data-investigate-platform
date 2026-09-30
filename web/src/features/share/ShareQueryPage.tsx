import Typography from '@mui/material/Typography';
import { useParams } from 'react-router';

export default function ShareQueryPage() {
  const { uuid } = useParams();
  return (
    <>
      <Typography variant="h5" component="h2" gutterBottom>
        Share query
      </Typography>
      <Typography color="text.secondary">{`Template: ${uuid ?? ''}`}</Typography>
    </>
  );
}
