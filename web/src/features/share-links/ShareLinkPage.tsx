import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { getRun, getRunRows, isApiError, isResultsGone, type Run } from '../../lib/api';
import { openRunTab } from '../action-tab';
import { useTabsStore } from '../tabs';
import { rowParam } from './shareLink';

const GONE = 'This result is no longer available';

/** The run, or `null` when it is unknown or expired, or its rows are gone. */
async function readRun(runId: string): Promise<Run | null> {
  try {
    const run = await getRun(runId);
    if (run.status === 'succeeded' && (run.rowCount ?? 0) > 0) await getRunRows(runId, 0, 1);
    return run;
  } catch (e) {
    if (isResultsGone(e) || (isApiError(e) && e.status === 404)) return null;
    throw e;
  }
}

/**
 * `#/runs/:runId?row=<n>`, a share link: opens the run in an ordinary tab, with the row it names
 * focused and its History open, and runs nothing. A run that is gone shows only that.
 */
export default function ShareLinkPage() {
  const { runId = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const loaded = useTabsStore((s) => s.loaded);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef<string | null>(null);
  const row = rowParam(search.get('row'));

  useEffect(() => {
    if (!loaded) return;
    const key = `${runId}|${row}`;
    if (handled.current === key) return; // StrictMode / re-render guard
    handled.current = key;
    readRun(runId).then(
      (run) => {
        if (!run) return setError(GONE);
        void navigate(`/view/${openRunTab(run, row)}`, { replace: true });
      },
      (e: unknown) =>
        setError(`Couldn't open the result: ${e instanceof Error ? e.message : String(e)}`),
    );
  }, [loaded, runId, row, navigate]);

  return (
    <Container sx={{ mt: 2 }}>
      {error ? (
        <Alert severity="error" variant="outlined">
          {error}
        </Alert>
      ) : (
        <CircularProgress size={24} aria-label="Opening the result" />
      )}
    </Container>
  );
}
