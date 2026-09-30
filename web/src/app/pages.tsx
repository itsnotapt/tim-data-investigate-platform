import Typography from '@mui/material/Typography';
import { useParams } from 'react-router';

function Placeholder({ title, detail }: { title: string; detail?: string }) {
  return (
    <>
      <Typography variant="h5" gutterBottom>
        {title}
      </Typography>
      <Typography color="text.secondary">
        {detail ?? 'Placeholder page (not implemented yet).'}
      </Typography>
    </>
  );
}

export const HomePage = () => (
  <Placeholder title="Welcome" detail="Home placeholder (legacy Welcome)." />
);
export const QueryManagerPage = () => <Placeholder title="Query Manager" />;
export const ExportImportPage = () => <Placeholder title="Export / Import" />;

export function ViewPage() {
  const { uuid } = useParams();
  return <Placeholder title="View" detail={`Display component: ${uuid ?? ''}`} />;
}

export function ShareQueryPage() {
  const { uuid } = useParams();
  return <Placeholder title="Share query" detail={`Template: ${uuid ?? ''}`} />;
}
