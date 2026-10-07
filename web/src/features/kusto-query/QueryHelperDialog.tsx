import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { DraggableDialog } from '../../components/DraggableDialog';
import { getConfig } from '../../lib/config/runtimeConfig';
import {
  buildTagEventsSample,
  DEFAULT_QUERY_EXAMPLE,
  TIME_RANGE_SAMPLE,
} from './queryHelperSamples';

export interface QueryHelperDialogProps {
  open: boolean;
  onClose: () => void;
  /** Override the tag cluster/database shown in the sample (defaults to runtime config). */
  tagCluster?: string;
  tagDatabase?: string;
}

const REQUIRED_FIELDS = [
  { name: 'EventId', type: 'Tagging', comment: 'Unique identifier for this event.' },
  {
    name: 'EventTime',
    type: 'Tagging, Queries',
    comment: 'Set to an interesting time e.g. EventTime, FileCreationTime.',
  },
  {
    name: 'Cluster',
    type: 'Queries',
    comment: 'Set to the cluster where the data exists. Required for almost all pivots.',
  },
];

function Code({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ my: 1, p: 1, overflow: 'auto' }}>
      <Box
        component="pre"
        aria-label={label}
        sx={{ m: 0, fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre' }}
      >
        {children}
      </Box>
    </Paper>
  );
}

function Heading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Typography id={id} variant="subtitle2" sx={{ mt: 2.5 }}>
      {children}
    </Typography>
  );
}

/** "Query Help" dialog. */
export function QueryHelperDialog({
  open,
  onClose,
  tagCluster,
  tagDatabase,
}: QueryHelperDialogProps) {
  // Only read config when the dialog is shown and no override was given.
  const cfg = open && (!tagCluster || !tagDatabase) ? getConfig() : null;
  const cluster = tagCluster ?? cfg?.tagCluster ?? '';
  const database = tagDatabase ?? cfg?.tagDatabase ?? '';

  return (
    <DraggableDialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      title="Query Help"
      actions={<Button onClick={onClose}>Close</Button>}
    >
      <Heading id="qh-required">Required Fields</Heading>
      <Table size="small" aria-labelledby="qh-required">
        <TableHead>
          <TableRow>
            <TableCell>Field</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Comment</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {REQUIRED_FIELDS.map((f) => (
            <TableRow key={f.name}>
              <TableCell>
                <code>{f.name}</code>
              </TableCell>
              <TableCell>{f.type}</TableCell>
              <TableCell>{f.comment}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Heading id="qh-time">Time Range Parameters</Heading>
      <Typography sx={{ my: 1 }}>
        The <code>StartTime</code> and <code>EndTime</code> time range parameters are injected into
        the Kusto query using <code>query_parameters</code>.
      </Typography>
      <Code label="Time range sample">
        {TIME_RANGE_SAMPLE.split(/(StartTime|EndTime)/).map((part, i) =>
          i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
        )}
      </Code>

      <Heading id="qh-tags">Tagged Events</Heading>
      <Typography sx={{ my: 1 }}>
        This helper function can be used to highlight events that have been tagged by yourself or
        other analysts. The table must have a column named <code>EventId</code>.
      </Typography>
      <Code label="Tagged events sample">{buildTagEventsSample(cluster, database)}</Code>

      <Heading id="qh-examples">Examples</Heading>
      <Code label="Default query example">{DEFAULT_QUERY_EXAMPLE}</Code>
      <Code label="More examples">More examples...</Code>
    </DraggableDialog>
  );
}
