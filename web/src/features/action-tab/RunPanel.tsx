import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import TimerOffIcon from '@mui/icons-material/TimerOff';
import WarningIcon from '@mui/icons-material/Warning';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import type { Run, RunStatus } from '../../lib/api';
import { datetimeText, paramText, valueText } from './paramValues';
import { durationText, statusText } from './runText';

export interface RunPanelProps {
  /** The tab's latest run, or `null` when it has none (not run yet, or it could not start). */
  run: Run | null;
  /** The tab's error: why the run failed or could not start. */
  error: string | null;
}

function StatusIcon({ status }: { status: RunStatus }) {
  const sx = { fontSize: 18 };
  switch (status) {
    case 'running':
      return <CircularProgress size={14} />;
    case 'succeeded':
      return <CheckCircleIcon color="success" sx={sx} />;
    case 'error':
      return <ErrorIcon color="error" sx={sx} />;
    case 'timedOut':
      return <TimerOffIcon color="error" sx={sx} />;
    case 'cancelled':
      return <CancelIcon color="disabled" sx={sx} />;
  }
}

function Section({ title, rows }: { title: string; rows: ReactNode[][] }) {
  if (rows.length === 0) return null;
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" component="h3" id={`run-${title}`}>
        {title}
      </Typography>
      <Table size="small" aria-labelledby={`run-${title}`} sx={{ width: 'auto' }}>
        <TableBody>
          {rows.map((cells, i) => (
            <TableRow key={i}>
              {cells.map((cell, j) => (
                <TableCell key={j} sx={{ fontFamily: j === 0 ? undefined : 'monospace' }}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

/**
 * The Run inner tab: the latest run's status, start, duration and id; why it failed; its details
 * in order (a `warning` gets a warning icon); its columns; and the params it ran with.
 */
export function RunPanel({ run, error }: RunPanelProps) {
  if (!run && !error) {
    return (
      <Typography color="text.secondary" sx={{ p: 2 }}>
        Not run yet.
      </Typography>
    );
  }
  const duration = run?.details?.duration;
  return (
    <Box sx={{ p: 1 }}>
      {run && (
        <Box
          component="dl"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            columnGap: 2,
            rowGap: 0.5,
            m: 0,
            mb: 1,
            '& dt': { color: 'text.secondary' },
            '& dd': { m: 0 },
          }}
        >
          <dt>Status</dt>
          <Box component="dd" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <StatusIcon status={run.status} />
            <span>{statusText(run.status, run.rowCount)}</span>
          </Box>
          <dt>Started</dt>
          <dd>{datetimeText(run.startedAt)}</dd>
          {typeof duration === 'number' && (
            <>
              <dt>Duration</dt>
              <dd>{durationText(duration)}</dd>
            </>
          )}
          <dt>Run id</dt>
          <Box component="dd" sx={{ fontFamily: 'monospace' }}>
            {run.runId}
          </Box>
        </Box>
      )}
      {error && (
        <Alert severity="error" variant="outlined">
          <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
            {error}
          </Box>
        </Alert>
      )}
      {run && (
        <>
          <Section
            title="Details"
            rows={Object.entries(run.details ?? {}).map(([key, value]) => [
              <Box
                key="key"
                component="span"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
              >
                {key === 'warning' && (
                  <WarningIcon
                    color="warning"
                    role="img"
                    aria-hidden={false}
                    aria-label="Warning"
                    sx={{ fontSize: 16 }}
                  />
                )}
                {key}
              </Box>,
              valueText(value),
            ])}
          />
          <Section
            title="Columns"
            rows={(run.columns ?? []).map((c) => [
              c.name,
              c.type,
              c.declared ? 'declared' : 'inferred',
            ])}
          />
          <Section
            title="Params"
            rows={Object.entries(run.params).map(([name, value]) => [name, paramText(value)])}
          />
        </>
      )}
    </Box>
  );
}
