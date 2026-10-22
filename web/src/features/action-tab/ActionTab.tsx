import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { CodeEditor, type CodeEditorInstance } from '../../components/CodeEditor';
import type { CatalogueParam, InstanceConnection } from '../../lib/api';
import { useInstanceStore } from '../instance';
import { NewQueryMenu } from '../new-query';
import type { TabComponentProps } from '../tabs/tabRegistry';
import { useTabsStore } from '../tabs/tabStore';
import { useTemplatesStore } from '../templates';
import { useActionPivotMenu } from '../action-pivots';
import { ActionResultsGrid, StoredActionResultsGrid } from './ActionResultsGrid';
import { cancelActionTab, runActionTab } from './actionRuns';
import { cloneActionTab } from './cloneActionTab';
import { useEditorSchema, type SchemaHandler } from './editorSchema';
import { applyEditorSchema } from './editorSchemaAdapters';
import { datetimeText, hasPill, paramTitles, sameParams, stillMissing } from './paramValues';
import { PillsBar } from './PillsBar';
import { RunPanel } from './RunPanel';
import { useRunRows } from './runRows';
import { durationText, outcomeText } from './runText';
import { useElapsed } from './useElapsed';

export interface ActionTabProps extends TabComponentProps {
  /** Overrides the run (default `runActionTab`). */
  onRun?: (uuid: string) => void;
  /** Overrides the cancel (default `cancelActionTab`). */
  onCancel?: (uuid: string) => void;
}

type InnerTab = 'query' | 'results' | 'run';

const NO_CONNECTIONS: readonly InstanceConnection[] = [];
const defaultRun = (uuid: string) => void runActionTab(uuid);
const defaultCancel = (uuid: string) => void cancelActionTab(uuid);

/**
 * The editor of a `kql` or `sql` param, completing from the schema of its `schemaFrom` params, and
 * marked with the reason when the server refused it.
 */
function QueryEditor({
  uuid,
  param,
  params,
  values,
  error,
  onChange,
  onRun,
}: {
  uuid: string;
  param: CatalogueParam;
  /** The action's params, and the values of all of them. */
  params: readonly CatalogueParam[];
  values: Record<string, unknown>;
  error: string | undefined;
  onChange: (value: string | undefined) => void;
  /** Ctrl/Cmd+Enter. */
  onRun: () => void;
}) {
  const [editor, setEditor] = useState<CodeEditorInstance | null>(null);
  const applySchema = useMemo<SchemaHandler | null>(
    () => (editor ? (loaded, signal) => applyEditorSchema(editor, loaded, signal) : null),
    [editor],
  );
  useEditorSchema(param, params, values, applySchema);
  const value = values[param.name];
  const captionId = `${uuid}-${param.name}-caption`;
  const caption = error ?? param.help;
  return (
    <Box
      role="group"
      aria-label={param.title}
      aria-invalid={error !== undefined || undefined}
      aria-describedby={error !== undefined ? captionId : undefined}
      // Capturing, so the editor never sees the shortcut (Monaco inserts a line on Ctrl+Enter).
      onKeyDownCapture={(e) => {
        if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        e.stopPropagation();
        onRun();
      }}
    >
      <Box
        sx={{
          height: 'calc(100vh - 240px)',
          minHeight: 160,
          border: '1px solid',
          borderColor: error !== undefined ? 'error.main' : 'editor.border',
        }}
      >
        <CodeEditor
          language={param.kind === 'kql' ? 'kusto' : 'plaintext'}
          path={`${uuid}.${param.name}.${param.kind}`}
          ariaLabel={param.title}
          value={typeof value === 'string' ? value : ''}
          onChange={(text) => onChange(text === '' ? undefined : text)}
          onMount={setEditor}
        />
      </Box>
      {caption && (
        <Typography
          id={captionId}
          variant="caption"
          color={error !== undefined ? 'error' : 'text.secondary'}
        >
          {caption}
        </Typography>
      )}
    </Box>
  );
}

/**
 * An action tab: the header (menu path, action and title) with Clone, the pills bar with Run or
 * the run going, and the inner tabs: the query of an action with a `kql` or `sql` param, the
 * results of the last run that succeeded, and the latest run's details. An action with a query
 * never switches inner tabs: a status line above the editor says how the latest run went. A pivot
 * that left params missing waits for them, with its reasons.
 */
export function ActionTab({ uuid, onRun = defaultRun, onCancel = defaultCancel }: ActionTabProps) {
  const tab = useTabsStore((s) => s.tabs[uuid]);
  const navigate = useNavigate();
  const pivotMenu = useActionPivotMenu(uuid, onRun);
  const actions = useInstanceStore((s) => s.instance?.actions);
  const connections = useInstanceStore((s) => s.instance?.connections ?? NO_CONNECTIONS);
  const shown = useRunRows(uuid);
  const templates = useTemplatesStore((s) => s.templates);
  const queryOptions = useTemplatesStore((s) => s.queryOptions);
  const actionState = tab?.componentName === 'ActionResult' ? tab.state : undefined;
  const elapsed = useElapsed(
    actionState?.isExecuting && actionState.run?.status === 'running'
      ? actionState.run.startedAt
      : null,
  );
  // The inner tab the analyst picked, held until the run changes: a run starts, gets its id or ends.
  const runKey = `${actionState?.run?.runId ?? ''}:${String(actionState?.isExecuting ?? false)}`;
  const [picked, setPicked] = useState<{ tab: InnerTab; runKey: string } | null>(null);

  if (tab?.componentName !== 'ActionResult') return null;
  const { state, params } = tab;
  const action = actions?.find((a) => a.key === params.action);
  const queryParam = action?.params.find((p) => !hasPill(p));
  const actionName = action?.name ?? state.run?.action.name ?? params.action;
  const hasResults = state.resultsRunId != null && state.rowCount !== null;
  // Rows loaded in this session, as each page arrives; else the stored rows of the last run.
  const rowCount = shown ? shown.rows.length : state.rowCount;
  const resultsLabel = shown
    ? `Results · ${shown.rows.length}${shown.done ? '' : ` of ${shown.total}`}`
    : hasResults
      ? `Results · ${state.rowCount}`
      : 'Results';

  const duration = state.run?.details?.duration;
  const runLabel =
    state.run?.status !== 'running' && typeof duration === 'number'
      ? `Run · ${durationText(duration)}`
      : 'Run';
  const inner: InnerTab =
    picked?.runKey === runKey ? picked.tab : queryParam ? 'query' : state.error ? 'run' : 'results';
  const pick = (value: InnerTab) => setPicked({ tab: value, runKey });
  // Rows of the run going load into `shown`; any other rows on show are from an earlier run.
  const showingPrevious = state.isExecuting && !(shown && !shown.done);
  const resultsFrom = state.resultsStartedAt
    ? `the run from ${datetimeText(state.resultsStartedAt)}`
    : 'the previous run';
  const edited = state.runParams != null && !sameParams(state.runParams, params.params);
  const needed = stillMissing(state.pivotMissing, params.params);
  const neededReasons = needed.flatMap((name) => state.pivotMissing?.[name] ?? []);

  const setParam = (name: string, value: unknown) => {
    const next = { ...params.params };
    if (value === undefined) delete next[name];
    else next[name] = value;
    const tabs = useTabsStore.getState();
    tabs.updateParams(uuid, { params: next });
    if (state.paramErrors?.[name] !== undefined) {
      const paramErrors = { ...state.paramErrors };
      delete paramErrors[name];
      tabs.updateState(uuid, { paramErrors });
    }
  };
  const reset = () => {
    if (!state.runParams) return;
    useTabsStore.getState().updateParams(uuid, { params: state.runParams });
    useTabsStore.getState().updateState(uuid, { paramErrors: null });
  };
  const clone = () => {
    const copy = cloneActionTab(uuid);
    if (copy) void navigate(`/view/${copy}`);
  };

  const runNow = () => {
    if (action && !state.isExecuting) onRun(uuid);
  };
  const succeededWithResults =
    !state.isExecuting &&
    !state.error &&
    state.run?.status === 'succeeded' &&
    state.run.runId === state.resultsRunId &&
    state.rowCount !== null;
  const queryStatus = state.isExecuting ? null : state.error ? (
    <Alert
      severity="error"
      variant="outlined"
      sx={{ mb: 0.5, py: 0 }}
      action={
        <Button color="inherit" size="small" onClick={() => pick('run')}>
          Details
        </Button>
      }
    >
      <span>{state.error.message}</span>
    </Alert>
  ) : succeededWithResults ? (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
      <Typography variant="body2">
        {[
          'Succeeded',
          `${state.rowCount} ${state.rowCount === 1 ? 'row' : 'rows'}`,
          ...(typeof duration === 'number' ? [durationText(duration)] : []),
        ].join(' · ')}
      </Typography>
      <Button size="small" onClick={() => pick('results')}>
        Show results
      </Button>
    </Box>
  ) : null;

  const run = state.isExecuting ? (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1 }}>
      <CircularProgress size={16} aria-label="Running" />
      <Typography variant="body2" sx={{ minWidth: 48 }}>
        {state.cancelling ? 'Cancelling…' : elapsed !== null ? durationText(elapsed) : 'Starting…'}
      </Typography>
      <Button
        size="small"
        variant="outlined"
        disabled={state.cancelling === true || state.run?.status !== 'running'}
        onClick={() => onCancel(uuid)}
      >
        Cancel
      </Button>
    </Box>
  ) : (
    <Button
      variant="contained"
      size="small"
      startIcon={<PlayArrowIcon />}
      disabled={!action}
      onClick={runNow}
    >
      Run
    </Button>
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1 }}>
        <NewQueryMenu templates={templates} queryOptions={queryOptions} size="small">
          <AddIcon fontSize="small" sx={{ mr: 0.5 }} />
          New
        </NewQueryMenu>
        <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
        <Box component="header" sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" component="div">
            {action && action.menuPath.length > 0 && (
              <>
                <span>{action.menuPath.join(' / ')}</span>
                {' · '}
              </>
            )}
            <span>{actionName}</span>
          </Typography>
          <Typography variant="subtitle1" component="h2" noWrap>
            {tab.title}
          </Typography>
        </Box>
        <Button
          size="small"
          startIcon={<ContentCopyIcon />}
          onClick={clone}
          sx={{ ml: 'auto', flexShrink: 0 }}
        >
          Clone
        </Button>
      </Box>

      {!action && (
        <Alert severity="warning" variant="outlined" sx={{ mx: 1, my: 0.5 }}>
          This action is no longer available.
        </Alert>
      )}

      <PillsBar
        params={action?.params ?? []}
        values={params.params}
        connections={connections}
        onChange={setParam}
        errors={state.paramErrors}
        onReset={edited ? reset : undefined}
        needed={needed}
        end={run}
      />

      {needed.length > 0 && !state.isExecuting && (
        <Alert severity="warning" variant="outlined" sx={{ mx: 1, my: 0.5 }}>
          <div>Fill in {paramTitles(action, needed)} to run this pivot</div>
          {neededReasons.map((reason) => (
            <div key={reason}>{reason}</div>
          ))}
        </Alert>
      )}

      <Tabs
        value={inner}
        onChange={(_, value: InnerTab) => pick(value)}
        sx={{ px: 1, minHeight: 36 }}
      >
        {queryParam && <Tab value="query" label="Query" sx={{ minHeight: 36, py: 0 }} />}
        <Tab value="results" label={resultsLabel} sx={{ minHeight: 36, py: 0 }} />
        <Tab value="run" label={runLabel} sx={{ minHeight: 36, py: 0 }} />
      </Tabs>
      {queryParam && (
        <Box role="tabpanel" aria-label="Query" hidden={inner !== 'query'} sx={{ px: 1 }}>
          {queryStatus}
          <QueryEditor
            uuid={uuid}
            param={queryParam}
            params={action?.params ?? []}
            values={params.params}
            error={state.paramErrors?.[queryParam.name]}
            onChange={(value) => setParam(queryParam.name, value)}
            onRun={runNow}
          />
        </Box>
      )}
      <Box role="tabpanel" aria-label={runLabel} hidden={inner !== 'run'} sx={{ px: 1 }}>
        <RunPanel run={state.run ?? null} error={state.error?.message ?? null} />
      </Box>
      {inner === 'results' && hasResults && showingPrevious && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 0.5 }}>
          Showing {resultsFrom}
        </Typography>
      )}
      {inner === 'results' && hasResults && !state.isExecuting && state.error && (
        <Alert severity="warning" variant="outlined" role="status" sx={{ mx: 1, mb: 0.5 }}>
          {outcomeText(state.run)} Showing {resultsFrom}
        </Alert>
      )}
      <Box
        data-slot="results-grid"
        role="tabpanel"
        aria-label={resultsLabel}
        aria-busy={hasResults && showingPrevious ? true : undefined}
        hidden={inner !== 'results'}
        sx={{ px: 1, opacity: hasResults && showingPrevious ? 0.5 : 1 }}
      >
        {(shown?.done ?? hasResults) && rowCount === 0 && (
          <Typography color="text.secondary" sx={{ p: 2 }}>
            The run succeeded with no rows.
          </Typography>
        )}
        {shown && rowCount !== 0 && (
          <ActionResultsGrid
            key={shown.runId}
            uuid={uuid}
            action={params.action}
            rows={shown.rows}
            declaredColumns={action?.columns}
            runColumns={shown.columns}
            getContextMenuItems={pivotMenu}
          />
        )}
        {!shown && hasResults && rowCount !== 0 && (
          <StoredActionResultsGrid
            uuid={uuid}
            action={params.action}
            rowDataTrigger={tab.rowDataTrigger}
            declaredColumns={action?.columns}
            runColumns={state.resultColumns}
            getContextMenuItems={pivotMenu}
          />
        )}
      </Box>
    </Box>
  );
}
