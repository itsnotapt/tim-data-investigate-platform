import AddIcon from '@mui/icons-material/Add';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import type { InstanceConnection } from '../../lib/api';
import { useInstanceStore } from '../instance';
import { NewQueryMenu } from '../new-query';
import type { TabComponentProps } from '../tabs/tabRegistry';
import { useTabsStore } from '../tabs/tabStore';
import { useTemplatesStore } from '../templates';
import { ActionResultsGrid } from './ActionResultsGrid';
import { runActionTab } from './actionRuns';
import { PillsBar } from './PillsBar';

export interface ActionTabProps extends TabComponentProps {
  /** Overrides the run (default `runActionTab`). */
  onRun?: (uuid: string) => void;
}

const NO_CONNECTIONS: readonly InstanceConnection[] = [];
const defaultRun = (uuid: string) => void runActionTab(uuid);

/**
 * An action tab: the header (menu path, action and title), the pills bar with Run, and the
 * results of the last run that succeeded.
 */
export function ActionTab({ uuid, onRun = defaultRun }: ActionTabProps) {
  const tab = useTabsStore((s) => s.tabs[uuid]);
  const actions = useInstanceStore((s) => s.instance?.actions);
  const connections = useInstanceStore((s) => s.instance?.connections ?? NO_CONNECTIONS);
  const templates = useTemplatesStore((s) => s.templates);
  const queryOptions = useTemplatesStore((s) => s.queryOptions);

  if (tab?.componentName !== 'ActionResult') return null;
  const { state, params } = tab;
  const action = actions?.find((a) => a.key === params.action);
  const actionName = action?.name ?? state.run?.action.name ?? params.action;
  const hasResults = state.resultsRunId != null && state.rowCount !== null;

  const setParam = (name: string, value: unknown) => {
    const next = { ...params.params };
    if (value === undefined) delete next[name];
    else next[name] = value;
    useTabsStore.getState().updateParams(uuid, { params: next });
  };

  const run = state.isExecuting ? (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1 }}>
      <CircularProgress size={16} aria-label="Running" />
      <Typography variant="body2">Running…</Typography>
    </Box>
  ) : (
    <Button
      variant="contained"
      size="small"
      startIcon={<PlayArrowIcon />}
      disabled={!action}
      onClick={() => onRun(uuid)}
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
        end={run}
      />

      {state.error && (
        <Alert severity="error" variant="outlined" sx={{ mx: 1, mb: 1 }}>
          <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
            {state.error.message}
          </Box>
        </Alert>
      )}

      <Tabs value="results" sx={{ px: 1, minHeight: 36 }}>
        <Tab
          value="results"
          label={hasResults ? `Results · ${state.rowCount}` : 'Results'}
          sx={{ minHeight: 36, py: 0 }}
        />
      </Tabs>
      <Box data-slot="results-grid" sx={{ px: 1 }}>
        {hasResults && state.rowCount === 0 && (
          <Typography color="text.secondary" sx={{ p: 2 }}>
            The run succeeded with no rows.
          </Typography>
        )}
        {hasResults && state.rowCount !== 0 && (
          <ActionResultsGrid
            uuid={uuid}
            rowDataTrigger={tab.rowDataTrigger}
            declaredColumns={action?.columns}
            runColumns={state.resultColumns}
          />
        )}
      </Box>
    </Box>
  );
}
