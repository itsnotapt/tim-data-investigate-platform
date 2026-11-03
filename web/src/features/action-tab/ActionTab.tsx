import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LinkIcon from '@mui/icons-material/Link';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import SearchIcon from '@mui/icons-material/Search';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { InAppBar } from '../../components/AppBarSlot';
import { CodeEditor, type CodeEditorInstance } from '../../components/CodeEditor';
import { NotifyContext } from '../../components/notifyContext';
import type { CatalogueParam, InstanceConnection, Preset } from '../../lib/api';
import type { EditorLanguage } from '../../lib/monaco';
import { useInstanceStore } from '../instance';
import { NewQueryMenu } from '../new-query';
import { PresetsLoadErrorDialog, SavePresetDialog, usePresetsStore } from '../presets';
import { copyShareLink } from '../share-links';
import type { Transition } from '../tabs';
import { useTabsStore } from '../tabs/tabStore';
import { useActionPivotMenu } from '../action-pivots';
import { ActionResultsGrid } from './ActionResultsGrid';
import { cancelActionTab, runActionTab } from './actionRuns';
import { useDeclareStatement } from './declareStatement';
import { useEditorSchema, type LoadedEditorSchema, type SchemaHandler } from './editorSchema';
import { applyEditorSchema, claimEditorSchema, setEditorParameters } from './editorSchemaAdapters';
import {
  cloneOf,
  idColumnOf,
  idColumnSwitched,
  linkedRowShown as linkedRowWasShown,
  isEdited,
  linkIdColumnOf,
  paramEdited,
  paramsReset,
  savedAsPreset,
  stillNeeded,
  titleOf,
} from './model';
import { datetimeText, hasPill, paramTitles } from './paramValues';
import { PillsBar } from './PillsBar';
import { pills, queryParameters } from './queryParameters';
import { RunPanel } from './RunPanel';
import { useResults } from './results';
import { durationText, outcomeText } from './runText';
import { useElapsed } from './useElapsed';

export interface ActionTabProps {
  tabId: string;
  /** Overrides the run (default `runActionTab`). */
  onRun?: (tabId: string) => void;
  /** Overrides the cancel (default `cancelActionTab`). */
  onCancel?: (tabId: string) => void;
}

type InnerTab = 'query' | 'results' | 'run';

const NO_CONNECTIONS: readonly InstanceConnection[] = [];
/** The editor language of a query param's kind; other kinds are plain text. */
const EDITOR_LANGUAGES: Partial<Record<CatalogueParam['kind'], EditorLanguage>> = {
  kql: 'kusto',
  sql: 'sql',
};
/** The results grid's height: the window below the app bar, the tab's rows and the status bar. */
const GRID_HEIGHT = 'calc(100vh - 156px)';
const defaultRun = (tabId: string) => void runActionTab(tabId);
const defaultCancel = (tabId: string) => void cancelActionTab(tabId);

/** What the toast says after switching the Id column to `column`. */
const switchedText = (column: string | null) =>
  column === null
    ? 'Id column cleared: the rows have no id'
    : `Id column set to ${column}: labels now follow ${column}`;

/**
 * The editor of a `kql` or `sql` param, completing from the schema of its `schemaFrom` params, and
 * marked with the reason when the server refused it. The action's declare statement for the
 * query parameters shows above the query, outside its text.
 */
function QueryEditor({
  tabId,
  actionKey,
  param,
  params,
  values,
  error,
  onChange,
  onRun,
}: {
  tabId: string;
  /** The tab's action, whose declare statement for its query parameters shows above the query. */
  actionKey: string;
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
  const declared = queryParameters(values.parameters);
  // The query parameters by name and type, which is all the editor is given of them.
  const declaredKey = JSON.stringify(declared.map(({ name, type }) => [name, type]));
  // Read when a schema loads, which replaces the editor's query parameters.
  const declaredRef = useRef(declared);
  useEffect(() => {
    declaredRef.current = declared;
  });
  useEffect(() => {
    // A refusal leaves them to the next schema load.
    if (editor) setEditorParameters(editor, param.kind, declaredRef.current).catch(() => undefined);
  }, [editor, param.kind, declaredKey]);
  // The last schema given to the editor, which it takes back when focused.
  const loadedRef = useRef<LoadedEditorSchema | null>(null);
  const applySchema = useMemo<SchemaHandler | null>(
    () =>
      editor
        ? (loaded, signal) => {
            loadedRef.current = loaded;
            return applyEditorSchema(editor, loaded, signal, declaredRef.current);
          }
        : null,
    [editor],
  );
  useEffect(() => {
    if (!editor) return;
    // The page's editors share one Kusto language service: the focused one has it for its own.
    const focus = editor.onDidFocusEditorText(() => {
      claimEditorSchema(editor, param.kind, loadedRef.current, declaredRef.current).catch(
        () => undefined,
      );
    });
    return () => focus.dispose();
  }, [editor, param.kind]);
  useEditorSchema(param, params, values, applySchema);
  const declareStatement = useDeclareStatement(actionKey, declared);
  const value = values[param.name];
  const captionId = `${tabId}-${param.name}-caption`;
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
          height: 'calc(100vh - 170px)',
          minHeight: 160,
          border: '1px solid',
          borderColor: error !== undefined ? 'error.main' : 'editor.border',
        }}
      >
        <CodeEditor
          language={EDITOR_LANGUAGES[param.kind] ?? 'plaintext'}
          path={`${tabId}.${param.name}.${param.kind}`}
          ariaLabel={param.title}
          value={typeof value === 'string' ? value : ''}
          onChange={(text) => onChange(text === '' ? undefined : text)}
          onMount={setEditor}
          headerLine={declareStatement}
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

/** An icon button named by its tooltip. */
function TooltipButton({
  title,
  icon,
  disabled = false,
  onClick,
}: {
  title: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={title}>
      {/* A disabled button gets no pointer events, so the tooltip hangs on a wrapper. */}
      <span>
        <IconButton size="small" aria-label={title} disabled={disabled} onClick={onClick}>
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}

/**
 * An action tab. While it is on show, the app bar holds its menu path, action and title, with
 * Save…, Clone and Copy link. The tab starts with New, then Run or the run going, then the pills
 * bar; Run comes first so it stays put as the pills change. Then the inner tabs: the query of an
 * action with a `kql` or `sql` param, the results of the last run that succeeded, with the quick
 * filter beside the inner tabs, and the latest run's details. An action with a query never
 * switches inner tabs: a status line above the editor says how the latest run went. A pivot that
 * left params missing waits for them, with its reasons. A share link's row is shown on the Results
 * tab.
 */
export function ActionTab({ tabId, onRun = defaultRun, onCancel = defaultCancel }: ActionTabProps) {
  const tab = useTabsStore((s) => s.tabs[tabId]);
  const navigate = useNavigate();
  const pivotMenu = useActionPivotMenu(tabId, onRun);
  const actions = useInstanceStore((s) => s.instance?.actions);
  const connections = useInstanceStore((s) => s.instance?.connections ?? NO_CONNECTIONS);
  const action = actions?.find((a) => a.key === tab?.toRun.action);
  const idColumn = tab ? idColumnOf(tab, action) : null;
  // The rows of the run loading, as each page arrives; else those of the last run that succeeded.
  const shown = useResults(tabId, { idColumn, stored: tab?.results ?? null });
  const notify = useContext(NotifyContext);
  const latestRun = tab?.latest.run;
  const executing = tab?.status.executing ?? false;
  const elapsed = useElapsed(
    executing && latestRun?.status === 'running' ? latestRun.startedAt : null,
  );
  // The inner tab the analyst picked, held until the run changes: a run starts, gets its id or ends.
  const runKey = `${latestRun?.runId ?? ''}:${String(executing)}`;
  const [picked, setPicked] = useState<{ tab: InnerTab; runKey: string } | null>(null);
  // Save…: the preset the tab came from or was saved as, once the presets are fresh, or why they
  // couldn't be loaded.
  const [saving, setSaving] = useState<{ source?: Preset } | { error: string } | null>(null);
  const [quickFilter, setQuickFilter] = useState('');
  const onShow = useParams().tabId === tabId;

  if (!tab) return null;
  const { toRun, latest, results, status } = tab;
  const run = latest.run;
  const apply = (transition: Transition) => useTabsStore.getState().apply(tabId, transition);
  const queryParam = action?.params.find((p) => !hasPill(p));
  const actionName = action?.name ?? run?.action.name ?? toRun.action;
  // The rows the run returned once they have all arrived, else those so far.
  const rowCount = shown
    ? shown.done
      ? shown.total
      : shown.rows.length
    : (results?.rowCount ?? null);
  const resultsLabel = shown
    ? `Results · ${shown.done ? shown.total : `${shown.rows.length} of ${shown.total}`}`
    : results
      ? `Results · ${results.rowCount}`
      : 'Results';

  const duration = run?.details?.duration;
  const runLabel =
    run?.status !== 'running' && typeof duration === 'number'
      ? `Run · ${durationText(duration)}`
      : 'Run';
  const inner: InnerTab =
    status.linkedRow != null
      ? 'results'
      : picked?.runKey === runKey
        ? picked.tab
        : queryParam
          ? 'query'
          : status.error
            ? 'run'
            : 'results';
  const pick = (value: InnerTab) => setPicked({ tab: value, runKey });
  // Rows of the run going load into `shown`; any other rows on show are from an earlier run.
  const showingPrevious = status.executing && !(shown && !shown.done);
  const resultsFrom = results?.startedAt
    ? `the run from ${datetimeText(results.startedAt)}`
    : 'the previous run';
  // Query parameters have a pill each in place of the `parameters` param's.
  const pillsBar = pills(action?.params ?? [], toRun.params);
  const needed = stillNeeded(tab);
  const neededReasons = needed.flatMap((name) => status.pivotMissing?.[name] ?? []);

  const setParam = (name: string, value: unknown) => apply(paramEdited(name, value));
  const linkIdColumn = linkIdColumnOf(tab, action);
  const switchTo = (column: string | null) => {
    apply(idColumnSwitched(column));
    // Clearing goes back to the action's Id column.
    notify?.(switchedText(column ?? action?.idColumn ?? null));
  };
  const resultColumns = (shown?.columns ?? results?.columns ?? []).map((c) => c.name);
  // The run going, else the one whose results show.
  const linkRunId =
    run?.status === 'running' || run?.status === 'succeeded' ? run.runId : (results?.runId ?? null);
  const linkedRowShown = () => {
    pick('results');
    apply(linkedRowWasShown);
  };
  const clone = () => {
    const copy = useTabsStore
      .getState()
      .createTab({ parentId: tab.parentId, content: cloneOf(tab) });
    void navigate(`/view/${copy}`);
  };
  const openSave = async () => {
    const { presetId } = toRun;
    if (!presetId) {
      setSaving({});
      return;
    }
    await usePresetsStore.getState().refresh();
    const { error, presets } = usePresetsStore.getState();
    setSaving(error ? { error } : { source: presets.find((p) => p.presetId === presetId) });
  };
  const saved = (preset: Preset) => apply(savedAsPreset(preset, action));

  const runNow = () => {
    if (action && !status.executing) onRun(tabId);
  };
  const succeededWithResults =
    !status.executing &&
    !status.error &&
    run?.status === 'succeeded' &&
    run.runId === results?.runId;
  const queryStatus = status.executing ? null : status.error ? (
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
      <span>{status.error.message}</span>
    </Alert>
  ) : succeededWithResults ? (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
      <Typography variant="body2">
        {[
          'Succeeded',
          `${results.rowCount} ${results.rowCount === 1 ? 'row' : 'rows'}`,
          ...(typeof duration === 'number' ? [durationText(duration)] : []),
        ].join(' · ')}
      </Typography>
      <Button size="small" onClick={() => pick('results')}>
        Show results
      </Button>
    </Box>
  ) : null;

  const runButton = status.executing ? (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <CircularProgress size={16} aria-label="Running" />
      <Typography variant="body2" sx={{ minWidth: 48 }}>
        {status.cancelling ? 'Cancelling…' : elapsed !== null ? durationText(elapsed) : 'Starting…'}
      </Typography>
      <Button
        size="small"
        variant="outlined"
        disabled={status.cancelling || run?.status !== 'running'}
        onClick={() => onCancel(tabId)}
      >
        Cancel
      </Button>
    </Box>
  ) : (
    <Button
      variant="outlined"
      size="small"
      startIcon={<PlayArrowIcon />}
      disabled={!action}
      onClick={runNow}
      // Light primary text on the hover tint, which shows after each click, is under 4.5:1.
      sx={(theme) => theme.applyStyles('light', { color: 'primary.dark' })}
    >
      Run
    </Button>
  );

  const title = titleOf(tab);
  return (
    <Box>
      {onShow && (
        <InAppBar>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, ml: 1 }}>
            <Typography color="text.secondary" aria-hidden>
              ›
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap sx={{ flexShrink: 10 }}>
              {action && action.menuPath.length > 0 && (
                <>
                  <span>{action.menuPath.join(' / ')}</span>
                  {' · '}
                </>
              )}
              <span>{actionName}</span>
            </Typography>
            <Typography color="text.secondary" aria-hidden>
              ›
            </Typography>
            <Tooltip title={title}>
              <Typography variant="subtitle1" component="h2" noWrap sx={{ fontWeight: 500 }}>
                {title}
              </Typography>
            </Tooltip>
            <Box sx={{ display: 'flex', flexShrink: 0 }}>
              <TooltipButton
                title="Save…"
                icon={<BookmarkAddIcon fontSize="small" />}
                disabled={!action}
                onClick={() => void openSave()}
              />
              <TooltipButton
                title="Clone"
                icon={<ContentCopyIcon fontSize="small" />}
                onClick={clone}
              />
              <TooltipButton
                title="Copy link"
                icon={<LinkIcon fontSize="small" />}
                disabled={linkRunId === null}
                onClick={() =>
                  linkRunId !== null && void copyShareLink(linkRunId, null, notify, linkIdColumn)
                }
              />
            </Box>
          </Box>
        </InAppBar>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1 }}>
        <NewQueryMenu size="small">
          <AddIcon fontSize="small" sx={{ mr: 0.5 }} />
          New
        </NewQueryMenu>
        <Divider orientation="vertical" flexItem sx={{ my: 1 }} />
        <Box sx={{ flexShrink: 0 }}>{runButton}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <PillsBar
            params={pillsBar.params}
            values={pillsBar.values}
            connections={connections}
            onChange={setParam}
            errors={status.paramErrors}
            onReset={isEdited(tab) ? () => apply(paramsReset) : undefined}
            needed={needed}
            idColumn={{ current: idColumn, columns: resultColumns, onChange: switchTo }}
          />
        </Box>
      </Box>
      {saving && 'error' in saving && (
        <PresetsLoadErrorDialog
          error={saving.error}
          onRetry={() => void openSave()}
          onClose={() => setSaving(null)}
        />
      )}
      {saving && !('error' in saving) && action && (
        <SavePresetDialog
          action={action}
          params={toRun.params}
          source={saving.source}
          idColumn={linkIdColumn}
          onClose={() => setSaving(null)}
          onSaved={saved}
        />
      )}

      {!action && (
        <Alert severity="warning" variant="outlined" sx={{ mx: 1, my: 0.5 }}>
          This action is no longer available.
        </Alert>
      )}

      {needed.length > 0 && !status.executing && (
        <Alert severity="warning" variant="outlined" sx={{ mx: 1, my: 0.5 }}>
          <div>Fill in {paramTitles(pillsBar.params, needed)} to run this pivot</div>
          {neededReasons.map((reason) => (
            <div key={reason}>{reason}</div>
          ))}
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Tabs
          value={inner}
          onChange={(_, value: InnerTab) => pick(value)}
          sx={{ px: 1, minHeight: 36 }}
        >
          {queryParam && <Tab value="query" label="Query" sx={{ minHeight: 36, py: 0 }} />}
          <Tab value="results" label={resultsLabel} sx={{ minHeight: 36, py: 0 }} />
          <Tab value="run" label={runLabel} sx={{ minHeight: 36, py: 0 }} />
        </Tabs>
        {inner === 'results' && (shown || results) && rowCount !== 0 && (
          <TextField
            size="small"
            placeholder="Filter rows"
            value={quickFilter}
            onChange={(e) => setQuickFilter(e.target.value)}
            sx={{
              ml: 'auto',
              width: 280,
              '& .MuiInputBase-root': { typography: 'body2' },
              '& .MuiInputBase-input': { py: 0.75 },
            }}
            slotProps={{
              htmlInput: { 'aria-label': 'Filter rows' },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        )}
      </Box>
      {queryParam && (
        <Box role="tabpanel" aria-label="Query" hidden={inner !== 'query'} sx={{ px: 1 }}>
          {queryStatus}
          <QueryEditor
            tabId={tabId}
            actionKey={toRun.action}
            param={queryParam}
            params={action?.params ?? []}
            values={toRun.params}
            error={status.paramErrors?.[queryParam.name]}
            onChange={(value) => setParam(queryParam.name, value)}
            onRun={runNow}
          />
        </Box>
      )}
      <Box role="tabpanel" aria-label={runLabel} hidden={inner !== 'run'} sx={{ px: 1 }}>
        <RunPanel run={run} error={status.error?.message ?? null} />
      </Box>
      {inner === 'results' && results && showingPrevious && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 0.5 }}>
          Showing {resultsFrom}
        </Typography>
      )}
      {inner === 'results' && results && !status.executing && status.error && (
        <Alert severity="warning" variant="outlined" role="status" sx={{ mx: 1, mb: 0.5 }}>
          {outcomeText(run)} Showing {resultsFrom}
        </Alert>
      )}
      <Box
        data-slot="results-grid"
        role="tabpanel"
        aria-label={resultsLabel}
        aria-busy={results && showingPrevious ? true : undefined}
        hidden={inner !== 'results'}
        sx={{ px: 1, opacity: results && showingPrevious ? 0.5 : 1 }}
      >
        {(shown?.done ?? results !== null) && rowCount === 0 && (
          <Typography color="text.secondary" sx={{ p: 2 }}>
            The run succeeded with no rows.
          </Typography>
        )}
        {shown && rowCount !== 0 && (
          <ActionResultsGrid
            key={shown.runId}
            tabId={tabId}
            results={shown}
            onIdColumnChange={switchTo}
            linkIdColumn={linkIdColumn}
            declaredColumns={action?.columns}
            getContextMenuItems={pivotMenu}
            linkedRow={status.linkedRow}
            onLinkedRowShown={linkedRowShown}
            pivotRowIds={toRun.pivotRowIds}
            findPivotRows={action?.findPivotRows}
            quickFilterText={quickFilter}
            height={GRID_HEIGHT}
          />
        )}
      </Box>
    </Box>
  );
}
