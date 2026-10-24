import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { CustomToolPanelProps } from 'ag-grid-react';
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NotifyContext } from '../../components/notifyContext';
import type { ColumnView, ColumnViewFields } from '../../lib/api';
import { useTabsStore } from '../tabs';
import { useAppliedViewsStore } from './appliedViewsStore';
import { rankColumnViews } from './ranking';
import { SaveColumnViewDialog } from './SaveColumnViewDialog';
import { ACTION_DEFAULT_NAME, type ColumnViewController } from './useActionColumnView';
import { useTabColumnView } from './useTabColumnView';
import { ColumnViewMoreMenu } from './ColumnViewMoreMenu';
import { useSavedColumnViewsStore, type SavedColumnViewsState } from './savedColumnViewsStore';

/**
 * The Views tool panel of an action tab's side bar: Save…, Apply and Revert for the tab's column
 * view, and the views to pick from: the ones saved from the tab's preset or action and the Action
 * default, then the others by how many of the tab's columns they match. The views are refetched
 * each time the panel is created.
 */
export function ColumnViewsToolPanel(props: CustomToolPanelProps) {
  const controller = (props.context as { columnViews: ColumnViewController }).columnViews;
  const { uuid } = controller;
  const { scope, columnView, gridState, modified, entry, applied } = useTabColumnView(uuid);
  const views = useSavedColumnViewsStore((s) => s.views);
  const error = useSavedColumnViewsStore((s) => s.error);
  const notify = useContext(NotifyContext);
  const [showHidden, setShowHidden] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void useSavedColumnViewsStore.getState().refresh();
  }, []);

  const columns = gridState?.columnOrder?.orderedColIds;
  const ranked = useMemo(
    () => (scope ? rankColumnViews(views, scope, columns ?? [], { showHidden }) : null),
    [views, scope, columns, showHidden],
  );
  const source = columnView?.viewId ? views.find((v) => v.viewId === columnView.viewId) : undefined;

  /** Runs a change to a column view, and says so when it fails. */
  const change = (what: string, run: (s: SavedColumnViewsState) => Promise<unknown>) => {
    run(useSavedColumnViewsStore.getState()).catch((e: unknown) => {
      notify?.(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`);
    });
  };

  const save = async (fields: Omit<ColumnViewFields, 'state'>, over: ColumnView | null) => {
    const state = controller.current();
    if (!state || !scope) return;
    const store = useSavedColumnViewsStore.getState();
    const saved = over
      ? await store.replace(over.viewId, { ...fields, state })
      : await store.create({
          ...fields,
          state,
          savedFrom: scope,
        });
    useTabsStore.getState().updateState(uuid, {
      gridState: state,
      columnView: { viewId: saved.viewId, name: saved.name, baseline: state },
    });
  };

  const apply = () => {
    if (!scope || !columnView) return;
    const store = useAppliedViewsStore.getState();
    const done = columnView.viewId
      ? store.apply(scope, { viewId: columnView.viewId, name: columnView.name })
      : store.clear(scope);
    done.catch((e: unknown) => {
      notify?.(`Couldn't apply it: ${e instanceof Error ? e.message : String(e)}`);
    });
  };

  const item = (key: string, name: string, view: ColumnView | null, secondary?: ReactNode) => (
    <ListItem
      key={key}
      disablePadding
      secondaryAction={
        view && (
          <ColumnViewMoreMenu
            view={view}
            onHidden={(hidden) =>
              change(hidden ? 'hide it' : 'unhide it', (s) => s.setHidden(view.viewId, hidden))
            }
            onDelete={() => change('delete it', (s) => s.remove(view.viewId))}
          />
        )
      }
    >
      <ListItemButton
        dense
        selected={(columnView?.viewId ?? null) === (view?.viewId ?? null) && columnView !== null}
        onClick={() => controller.pick(view)}
      >
        <ListItemText
          primary={name}
          secondary={secondary}
          slotProps={{
            primary: { noWrap: true, color: view?.hidden ? 'text.secondary' : undefined },
          }}
        />
      </ListItemButton>
    </ListItem>
  );

  return (
    <Box sx={{ width: '100%', overflowY: 'auto', p: 1 }} data-testid="views-tool-panel">
      <Typography variant="subtitle2" noWrap>
        {columnView ? columnView.name : ACTION_DEFAULT_NAME}
        {applied && ' (applied)'}
        {modified && ' • modified'}
      </Typography>
      <Stack direction="row" spacing={0.5} sx={{ my: 1, flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" onClick={() => setSaving(true)}>
          Save…
        </Button>
        <Button
          size="small"
          disabled={!columnView || modified || applied || (columnView.viewId !== null && !source)}
          title={modified ? 'Save or revert the changes first' : undefined}
          onClick={apply}
        >
          Apply
        </Button>
        <Button size="small" disabled={!modified} onClick={() => controller.revert()}>
          Revert
        </Button>
      </Stack>
      {entry && (
        <Stack direction="row" sx={{ alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1 }}>
            New tabs start with "{entry.name}"
          </Typography>
          <IconButton
            size="small"
            aria-label="Start new tabs with the action default"
            onClick={() => scope && void useAppliedViewsStore.getState().clear(scope)}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      )}
      <FormControlLabel
        label="Hidden"
        control={
          <Switch
            size="small"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
        }
      />
      {error && (
        <Alert
          severity="warning"
          action={
            <Button size="small" onClick={() => void useSavedColumnViewsStore.getState().refresh()}>
              Retry
            </Button>
          }
        >
          Couldn't load column views: {error}
        </Alert>
      )}
      {ranked && (
        <List dense aria-label="Column views">
          {item('default', ACTION_DEFAULT_NAME, null)}
          {ranked.own.map((v) => item(v.viewId, v.name, v))}
          {ranked.others.length > 0 && <ListSubheader disableSticky>Other views</ListSubheader>}
          {ranked.others.map(({ view, matching, total }) =>
            item(view.viewId, view.name, view, `${matching} of ${total} columns match`),
          )}
        </List>
      )}
      {saving && (
        <SaveColumnViewDialog source={source} onSave={save} onClose={() => setSaving(false)} />
      )}
    </Box>
  );
}
