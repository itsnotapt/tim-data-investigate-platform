import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { CustomToolPanelProps } from 'ag-grid-react';
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NotifyContext } from '../../components/notifyContext';
import type { ColumnView, ColumnViewFields } from '../../lib/api';
import { useInstanceStore } from '../instance';
import { usePresetsStore } from '../presets';
import { useTabsStore } from '../tabs';
import { ColumnViewMoreMenu, type ColumnViewMenuItem } from './ColumnViewMoreMenu';
import { useDefaultViewsStore } from './defaultViewsStore';
import { rankColumnViews } from './ranking';
import { RenameColumnViewDialog } from './RenameColumnViewDialog';
import { SaveColumnViewDialog } from './SaveColumnViewDialog';
import { useSavedColumnViewsStore, type SavedColumnViewsState } from './savedColumnViewsStore';
import { BUILT_IN_NAME, type ColumnViewController } from './useActionColumnView';
import { useTabColumnView } from './useTabColumnView';

/**
 * The Views tool panel of an action tab's side bar: the column views to pick from, each with a
 * radio button marking the one the tab shows. Built-in comes first, then the column views saved
 * from the tab's preset or action, then those saved elsewhere by how many of the tab's columns they
 * match.
 * The column views are refetched each time the panel is created.
 */
export function ColumnViewsToolPanel(props: CustomToolPanelProps) {
  const controller = (props.context as { columnViews: ColumnViewController }).columnViews;
  const { uuid } = controller;
  const { scope, columnView, name, gridState, edited, defaultView } = useTabColumnView(uuid);
  const views = useSavedColumnViewsStore((s) => s.views);
  const error = useSavedColumnViewsStore((s) => s.error);
  const loaded = useSavedColumnViewsStore((s) => s.loaded);
  const presets = usePresetsStore((s) => s.presets);
  const actions = useInstanceStore((s) => s.instance?.actions);
  const notify = useContext(NotifyContext);
  /** The column view to switch to once the analyst says what happens to the tab's edits. */
  const [switching, setSwitching] = useState<{ view: ColumnView | null } | null>(null);
  /** The column view the Rename dialog is open for. */
  const [renaming, setRenaming] = useState<ColumnView | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  /**
   * The Save dialog while it's open: `fresh` always saves a new column view, and `then` is the
   * column view to switch to once it's saved.
   */
  const [saving, setSaving] = useState<{
    fresh: boolean;
    then?: { view: ColumnView | null };
  } | null>(null);

  useEffect(() => {
    void useSavedColumnViewsStore.getState().refresh();
  }, []);

  const columns = gridState?.columnOrder?.orderedColIds;
  const ranked = useMemo(
    () => (scope ? rankColumnViews(views, scope, columns ?? [], { showHidden: true }) : null),
    [views, scope, columns],
  );

  /** The name of a preset, else of an action, else the action's key. */
  const nameOf = ({ action, presetId }: { action: string; presetId?: string | null }) =>
    (presetId && presets.find((p) => p.presetId === presetId)?.name) ||
    actions?.find((a) => a.key === action)?.name ||
    action;
  const scopeName = scope ? nameOf(scope) : '';

  const isShown = (view: ColumnView | null) =>
    columnView !== null && columnView.viewId === (view?.viewId ?? null);
  /** The default view's id, `null` for Built-in, also when the default view is gone. */
  const defaultId =
    defaultView && (!loaded || views.some((v) => v.viewId === defaultView.viewId))
      ? defaultView.viewId
      : null;
  const isDefault = (view: ColumnView | null) => defaultId === (view?.viewId ?? null);

  /** Whether a hidden column view is listed anyway: the tab shows it, or it's the default view. */
  const kept = (view: ColumnView) => isShown(view) || isDefault(view);
  const listed = (view: ColumnView) => showHidden || !view.hidden || kept(view);
  const hiddenCount = ranked
    ? [...ranked.own, ...ranked.others.map((r) => r.view)].filter((v) => v.hidden && !kept(v))
        .length
    : 0;

  /** Runs a change to a column view, and says so when it fails. */
  const change = (what: string, run: (s: SavedColumnViewsState) => Promise<unknown>) => {
    run(useSavedColumnViewsStore.getState()).catch((e: unknown) => {
      notify?.(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`);
    });
  };

  /** New tabs of the tab's preset or action open with column view `view`, or Built-in for `null`. */
  const makeDefault = (view: ColumnView | null) => {
    if (!scope) return;
    const store = useDefaultViewsStore.getState();
    const done = view ? store.makeDefault(scope, view) : store.clear(scope);
    done
      .then(() => notify?.(`"${scopeName}" now opens with "${view?.name ?? BUILT_IN_NAME}".`))
      .catch((e: unknown) => {
        notify?.(`Couldn't change the default: ${e instanceof Error ? e.message : String(e)}`);
      });
  };

  const shownView = columnView?.viewId
    ? views.find((v) => v.viewId === columnView.viewId)
    : undefined;

  const save = async (
    fields: Omit<ColumnViewFields, 'state'>,
    over: ColumnView | null,
    asDefault: boolean,
  ) => {
    const state = controller.current();
    if (!state || !scope) return;
    const store = useSavedColumnViewsStore.getState();
    const saved = over
      ? await store.replace(over.viewId, { ...fields, state })
      : await store.create({ ...fields, state, savedFrom: scope });
    useTabsStore.getState().updateState(uuid, {
      gridState: state,
      columnView: { viewId: saved.viewId, name: saved.name, baseline: state },
    });
    if (asDefault) makeDefault(saved);
  };

  /** Renames the column view `view` and changes its sharing; its columns stay as they are. */
  const rename = async (view: ColumnView, fields: Omit<ColumnViewFields, 'state'>) => {
    const renamed = await useSavedColumnViewsStore
      .getState()
      .replace(view.viewId, { ...fields, state: view.state });
    const shown = useTabsStore.getState().tabs[uuid]?.state.columnView;
    if (shown?.viewId === renamed.viewId) {
      useTabsStore.getState().updateState(uuid, { columnView: { ...shown, name: renamed.name } });
    }
    if (scope && defaultView?.viewId === renamed.viewId) {
      await useDefaultViewsStore.getState().makeDefault(scope, renamed);
    }
  };

  /** Switches to the column view `view`, asking first when that would lose the tab's edits. */
  const choose = (view: ColumnView | null) => {
    if (isShown(view)) return;
    if (edited) setSwitching({ view });
    else controller.pick(view);
  };

  /** A row's ⋯ menu items, none of them disabled: Built-in has none while it's the default. */
  const menuItems = (view: ColumnView | null): ColumnViewMenuItem[] => {
    const items: ColumnViewMenuItem[] = [];
    if (!isDefault(view)) items.push({ label: 'Make default', onClick: () => makeDefault(view) });
    else if (view) items.push({ label: 'Stop using as default', onClick: () => makeDefault(null) });
    if (!view) return items;
    if (view.owned) items.push({ label: 'Rename…', onClick: () => setRenaming(view) });
    items.push({
      label: view.hidden ? 'Show in this list' : 'Hide from this list',
      onClick: () =>
        change(view.hidden ? 'show it' : 'hide it', (s) => s.setHidden(view.viewId, !view.hidden)),
    });
    return items;
  };

  const row = (view: ColumnView | null, secondary?: ReactNode) => {
    const rowName = view?.name ?? BUILT_IN_NAME;
    const items = menuItems(view);
    return (
      <ListItem
        key={view?.viewId ?? 'built-in'}
        disablePadding
        secondaryAction={
          items.length > 0 ? (
            <ColumnViewMoreMenu
              name={rowName}
              items={items}
              deleting={view?.owned ? view : undefined}
              onDelete={() => view && change('delete it', (s) => s.remove(view.viewId))}
            />
          ) : (
            <Box sx={{ width: 28 }} />
          )
        }
      >
        <ListItemButton dense selected={isShown(view)} onClick={() => choose(view)}>
          <ListItemIcon sx={{ minWidth: 32 }}>
            <Radio
              size="small"
              edge="start"
              checked={isShown(view)}
              tabIndex={-1}
              disableRipple
              slotProps={{ input: { 'aria-label': rowName } }}
            />
          </ListItemIcon>
          <ListItemText
            primary={rowName}
            secondary={
              isShown(view) && edited ? (
                <>
                  <Box component="span" sx={{ color: 'warning.main' }}>
                    Edited
                  </Box>
                  {secondary && <> · {secondary}</>}
                </>
              ) : (
                secondary
              )
            }
            slotProps={{
              primary: {
                noWrap: true,
                color: view ? undefined : 'text.secondary',
                sx: view ? undefined : { fontStyle: 'italic' },
              },
            }}
          />
          {isDefault(view) && (
            <Tooltip title={`Opens with this view whenever you run "${scopeName}"`}>
              <Chip
                size="small"
                label="Default"
                color="primary"
                variant="outlined"
                sx={{ ml: 1 }}
              />
            </Tooltip>
          )}
        </ListItemButton>
      </ListItem>
    );
  };

  const own = ranked?.own.filter(listed) ?? [];
  const others = ranked?.others.filter((r) => listed(r.view)) ?? [];

  return (
    <Box sx={{ width: '100%', overflowY: 'auto', p: 1 }} data-testid="views-tool-panel">
      {edited ? (
        <Alert severity="warning" icon={false} sx={{ mb: 1, py: 0 }}>
          <Typography variant="body2">Your changes to "{name}" aren't saved</Typography>
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
            <Button size="small" variant="contained" onClick={() => setSaving({ fresh: false })}>
              Save…
            </Button>
            <Button size="small" onClick={() => controller.revert()}>
              Discard
            </Button>
          </Stack>
        </Alert>
      ) : (
        <Button size="small" sx={{ mb: 1 }} onClick={() => setSaving({ fresh: true })}>
          Save as new view…
        </Button>
      )}
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
          {row(null, "The action's own columns")}
          {own.length > 0 && <Divider component="li" sx={{ my: 0.5 }} />}
          {own.map((v) => row(v))}
          {others.length > 0 && <ListSubheader disableSticky>Saved elsewhere</ListSubheader>}
          {others.map(({ view, matching, total }) =>
            row(view, `From ${nameOf(view.savedFrom)} · ${matching} of ${total} columns`),
          )}
        </List>
      )}
      {hiddenCount > 0 && (
        <Button size="small" onClick={() => setShowHidden(!showHidden)}>
          {showHidden
            ? "Don't show hidden views"
            : `Show ${hiddenCount} hidden view${hiddenCount === 1 ? '' : 's'}`}
        </Button>
      )}
      <Dialog
        open={switching !== null}
        onClose={() => setSwitching(null)}
        aria-labelledby="switch-view-title"
        maxWidth="xs"
      >
        <DialogTitle id="switch-view-title">
          Switch to "{switching?.view?.name ?? BUILT_IN_NAME}"?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Your changes to "{name}" aren't saved. Switching views replaces this tab's columns and
            filters.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSwitching(null)}>Cancel</Button>
          <Button
            color="warning"
            onClick={() => {
              if (switching) controller.pick(switching.view);
              setSwitching(null);
            }}
          >
            Discard and switch
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              setSaving({ fresh: false, then: switching ?? undefined });
              setSwitching(null);
            }}
          >
            Save first…
          </Button>
        </DialogActions>
      </Dialog>
      {renaming && (
        <RenameColumnViewDialog
          view={renaming}
          onSave={(fields) => rename(renaming, fields)}
          onClose={() => setRenaming(null)}
        />
      )}
      {saving && (
        <SaveColumnViewDialog
          source={saving.fresh ? undefined : shownView}
          scopeName={scopeName}
          onSave={async (fields, over, asDefault) => {
            await save(fields, over, asDefault);
            if (saving.then) controller.pick(saving.then.view);
          }}
          onClose={() => setSaving(null)}
        />
      )}
    </Box>
  );
}
