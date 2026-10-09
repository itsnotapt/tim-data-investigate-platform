import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import HelpOutlinedIcon from '@mui/icons-material/HelpOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { ClusterSelect } from '../../components/ClusterSelect';
import { validateClusterSelection } from '../../components/clusterSelection';
import { CodeEditor, type CodeEditorInstance } from '../../components/CodeEditor';
import { TimeRangePicker } from '../../components/TimeRangePicker';
import { DEFAULT_TIME_RANGE, type TimeRange } from '../../lib/time-range';
import { PivotResultsGrid } from '../pivots';
import { NewQueryMenu } from '../new-query';
import type { TabComponentProps } from '../tabs/tabRegistry';
import { useTabsStore } from '../tabs/tabStore';
import { useTemplatesStore } from '../templates';
import { QueryHelperDialog } from './QueryHelperDialog';
import { useKustoSchema } from './useKustoSchema';
import { useRunKustoQuery, type RunKustoQueryArgs } from './useRunKustoQuery';

export interface KustoQueryTabProps extends TabComponentProps {
  /** Run override (tests); defaults to `useRunKustoQuery()`. */
  onRun?: (args: RunKustoQueryArgs) => void;
}

interface Draft {
  title: string;
  cluster: string;
  database: string;
  query: string;
}

const Sep = () => <Divider orientation="vertical" flexItem sx={{ mx: 1, my: 0.5 }} />;

/**
 * Ad-hoc Kusto query tab Starts in edit mode (also after a reload). Edits live in a local draft until Save / Save & Run.
 */
export function KustoQueryTab({ uuid, onRun }: KustoQueryTabProps) {
  const tab = useTabsStore((s) => s.tabs[uuid]);
  const templates = useTemplatesStore((s) => s.templates);
  const queryOptions = useTemplatesStore((s) => s.queryOptions);
  const navigate = useNavigate();
  const defaultRun = useRunKustoQuery();
  const run = onRun ?? defaultRun;

  const [editing, setEditing] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [editor, setEditor] = useState<CodeEditorInstance | null>(null);
  const onEditorMount = useCallback((e: CodeEditorInstance) => {
    setEditor(e);
    e.onDidDispose(() => setEditor((cur) => (cur === e ? null : cur)));
  }, []);
  // Schema for IntelliSense follows the (draft) cluster and database while editing.
  const stored = tab?.componentName === 'KustoQueryResult' ? tab.params : null;
  useKustoSchema(
    editing ? (draft?.cluster ?? stored?.cluster ?? '') : '',
    editing ? (draft?.database ?? stored?.database ?? '') : '',
    editor,
  );

  if (tab?.componentName !== 'KustoQueryResult') return null;
  const { params, title, state } = tab;
  const timeRange = state.timeRange ?? DEFAULT_TIME_RANGE;

  // Entering edit mode (including the first render) copies the stored values into the draft.
  const form: Draft = draft ?? { title, ...params };
  const patch = (p: Partial<Draft>) => setDraft({ ...form, ...p });
  const store = useTabsStore.getState;

  const startEdit = () => {
    setDraft({ title, ...params });
    setShowErrors(false);
    setEditing(true);
  };
  const cancel = () => {
    setDraft(null);
    setEditing(false);
  };
  /** Returns false when validation fails (nothing is saved). */
  const save = (): boolean => {
    if (validateClusterSelection(form.cluster, form.database).length > 0) {
      setShowErrors(true);
      return false;
    }
    store().updateTitle(uuid, form.title);
    store().updateParams(uuid, {
      cluster: form.cluster,
      database: form.database,
      query: form.query,
    });
    setDraft(null);
    setEditing(false);
    return true;
  };
  const saveAndRun = () => {
    if (save()) run({ uuid, timeRange });
  };
  const clone = () => {
    const created = store().createTab({
      componentName: 'KustoQueryResult',
      parentUuid: null,
      title: `Copy of ${title}`,
      params: { ...params },
    });
    void navigate(`/view/${created}`);
  };
  const setTimeRange = (range: TimeRange) => store().updateState(uuid, { timeRange: range });

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', px: 1 }}>
        <NewQueryMenu templates={templates} queryOptions={queryOptions} size="small">
          <AddIcon fontSize="small" sx={{ mr: 0.5 }} />
          New
        </NewQueryMenu>
        <Sep />
        <TimeRangePicker value={timeRange} onChange={setTimeRange} />
        <Sep />
        <Button
          size="small"
          color="inherit"
          startIcon={<PlayArrowIcon />}
          disabled={editing}
          onClick={() => run({ uuid, timeRange })}
        >
          Run Query
        </Button>
        <Button
          size="small"
          color="inherit"
          startIcon={<ContentCopyIcon />}
          disabled={editing}
          onClick={clone}
        >
          Clone
        </Button>
        <Sep />
        {!editing && (
          <Button size="small" color="inherit" startIcon={<EditIcon />} onClick={startEdit}>
            Edit Query
          </Button>
        )}
        {editing && (
          <>
            <Button size="small" startIcon={<PlayArrowIcon />} onClick={saveAndRun}>
              Save Changes & Run
            </Button>
            <Button size="small" color="inherit" onClick={() => void save()}>
              Save Changes
            </Button>
            <Button size="small" color="inherit" onClick={cancel}>
              Cancel
            </Button>
          </>
        )}
      </Box>

      {editing && (
        <Box component="form" noValidate sx={{ mx: 2 }} onSubmit={(e) => e.preventDefault()}>
          <TextField
            label="Summary"
            value={form.title}
            onChange={(e) => patch({ title: e.target.value })}
            fullWidth
            margin="normal"
          />
          <ClusterSelect
            cluster={form.cluster}
            database={form.database}
            onClusterChange={(cluster) => patch({ cluster })}
            onDatabaseChange={(database) => patch({ database })}
            showErrors={showErrors}
          />
          <Typography color="text.secondary" sx={{ display: 'flex', alignItems: 'center' }}>
            Query
            <IconButton aria-label="Query Help" onClick={() => setHelpOpen(true)}>
              <HelpOutlinedIcon />
            </IconButton>
          </Typography>
          <Box
            sx={{
              height: 400,
              border: '1px dotted',
              borderColor: 'editor.border',
              mb: 2.5,
              resize: 'vertical',
              overflow: 'hidden',
            }}
          >
            <CodeEditor
              language="kusto"
              path={`${uuid}.kusto`}
              ariaLabel="Query"
              value={form.query}
              onChange={(query) => patch({ query })}
              onMount={onEditorMount}
            />
          </Box>
        </Box>
      )}

      {state.error && (
        <Alert severity="error" variant="outlined" sx={{ mx: 2, mb: 1 }}>
          <Box
            component="pre"
            sx={{ m: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.75em' }}
          >
            {state.error.message}
          </Box>
        </Alert>
      )}

      {tab.rowDataTrigger !== null && <PivotResultsGrid uuid={uuid} />}

      <QueryHelperDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </Box>
  );
}
