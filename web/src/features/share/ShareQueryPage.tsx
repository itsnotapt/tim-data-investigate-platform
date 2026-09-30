import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { DraggableDialog } from '../../components/DraggableDialog';
import {
  buildSummary,
  isDataComplete,
  type QueryTemplate,
  type TemplateParams,
} from '../../lib/kql-templates';
import { runTemplateQuery } from '../template-query/runTemplateQuery';
import { useTabsStore } from '../tabs';
import { useTemplatesStore } from '../templates';
import {
  decodeShareParams,
  PARAMS_INVALID,
  PARAMS_MISSING,
  sanitizeShareParams,
  TEMPLATE_NOT_FOUND,
} from './shareLink';

interface Pending {
  template: QueryTemplate;
  params: TemplateParams;
  title: string;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const asRecord = (v: object) => v as Record<string, unknown>;

/**
 * `#/share/:uuid?p=...&execute=0|1` (legacy ShareQuery.vue): recreates the tab as a root
 * `TemplateQueryResult` and opens it. `execute=1` runs it, but only after the user confirms
 * (SEC-06, Q-110); declining opens the tab in edit mode without running.
 */
export default function ShareQueryPage() {
  const { uuid = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const loaded = useTemplatesStore((s) => s.loaded);
  const templates = useTemplatesStore((s) => s.templates);
  const [decided, setDecided] = useState(false);
  const handled = useRef<string | null>(null);

  const p = search.get('p');
  const execute = search.get('execute') === '1';

  const parsed = useMemo<{ error: string } | { pending: Pending } | null>(() => {
    if (!loaded) return null;
    const template = templates.find((t) => t.uuid === uuid);
    if (!template) return { error: TEMPLATE_NOT_FOUND };
    if (!p) return { error: PARAMS_MISSING };
    let params: TemplateParams | null;
    try {
      params = sanitizeShareParams(template, decodeShareParams(p));
    } catch {
      params = null;
    }
    if (!params) return { error: PARAMS_INVALID };
    return { pending: { template, params, title: buildSummary(template, params) } };
  }, [loaded, templates, uuid, p]);
  const error = parsed && 'error' in parsed ? parsed.error : null;
  const pending = parsed && 'pending' in parsed && execute && !decided ? parsed.pending : null;

  const open = (t: Pending, run: boolean) => {
    setDecided(true);
    const complete = isDataComplete(t.template, t.params);
    const tabUuid = useTabsStore.getState().createTab({
      componentName: 'TemplateQueryResult',
      parentUuid: null,
      title: t.title,
      params: { inParams: clone(t.params), queryTemplate: asRecord(clone(t.template)) },
      state: { editQuery: !run || !complete },
    });
    if (run && complete) void runTemplateQuery(tabUuid);
    void navigate(`/view/${tabUuid}`, { replace: true });
  };

  useEffect(() => {
    if (!parsed || !('pending' in parsed) || execute) return;
    const key = `${uuid}|${p}`;
    if (handled.current === key) return; // StrictMode / re-render guard
    handled.current = key;
    open(parsed.pending, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, execute, uuid, p]);

  if (error) {
    return (
      <Container sx={{ mt: 2 }}>
        <Alert severity="error" variant="outlined">
          {error}
        </Alert>
      </Container>
    );
  }

  return (
    <Container sx={{ mt: 2 }}>
      {!pending && <CircularProgress size={24} aria-label="Loading shared query" />}
      <DraggableDialog
        open={pending !== null}
        title="Run shared query?"
        maxWidth="sm"
        fullWidth
        onClose={() => {
          if (pending) open(pending, false);
        }}
        actions={
          <>
            <Button color="inherit" onClick={() => pending && open(pending, false)}>
              Open without running
            </Button>
            <Button onClick={() => pending && open(pending, true)}>Run</Button>
          </>
        }
      >
        <Typography gutterBottom>
          This link asks to run a query automatically with the parameters below. Only run it if you
          trust the sender.
        </Typography>
        <Typography sx={{ fontWeight: 700 }}>{pending?.title}</Typography>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {pending ? JSON.stringify(pending.params, null, 2) : ''}
        </pre>
      </DraggableDialog>
    </Container>
  );
}
