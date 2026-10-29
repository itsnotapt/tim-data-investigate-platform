// PROTOTYPE: throwaway variants of the Views tool panel, switched by `?variant=` (hash URL, e.g.
// `#/?variant=B`). Question: what should the Views panel look like so that switching views can't
// silently lose work, and "the view new tabs start with" and hidden views are obvious?
// Variants: Current (the shipped panel), A (radio list + guard dialog + "New tabs" chip),
// B (two dropdowns + Undo snackbar + Manage dialog), C (explicit Use buttons + inline confirm +
// star + Hidden accordion). Not for main.
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
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
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { CustomToolPanelProps } from 'ag-grid-react';
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePrototypeVariant, type PrototypeVariant } from '../../components/PrototypeSwitcher';
import { NotifyContext } from '../../components/notifyContext';
import type { ColumnView, ColumnViewFields } from '../../lib/api';
import { usePresetsStore } from '../presets/presetsStore';
import { useTabsStore } from '../tabs';
import { useAppliedViewsStore } from './appliedViewsStore';
import { ColumnViewsToolPanel } from './ColumnViewsToolPanel';
import { rankColumnViews } from './ranking';
import { SaveColumnViewDialog } from './SaveColumnViewDialog';
import { useSavedColumnViewsStore, type SavedColumnViewsState } from './savedColumnViewsStore';
import { ACTION_DEFAULT_NAME, type ColumnViewController } from './useActionColumnView';
import { useTabColumnView } from './useTabColumnView';

// eslint-disable-next-line react-refresh/only-export-components -- prototype
export const VIEWS_PANEL_VARIANTS: PrototypeVariant[] = [
  { key: 'current', name: 'Shipped panel' },
  { key: 'A', name: 'Radio list, guard dialog, New tabs chip' },
  { key: 'A2', name: 'A, reworded: Default, Built-in, Saved elsewhere' },
  { key: 'B', name: 'Two dropdowns, Undo, Manage dialog' },
  { key: 'C', name: 'Use buttons, inline confirm, star, Hidden accordion' },
];

export function ViewsPanelPrototype(props: CustomToolPanelProps) {
  const variant = usePrototypeVariant(VIEWS_PANEL_VARIANTS);
  if (variant === 'A') return <VariantA {...props} terms={TERMS_A} />;
  if (variant === 'A2') return <VariantA {...props} terms={TERMS_A2} />;
  if (variant === 'B') return <VariantB {...props} />;
  if (variant === 'C') return <VariantC {...props} />;
  return <ColumnViewsToolPanel {...props} />;
}

// ---- Shared data (not layout) ---------------------------------------------------------------

const DEFAULT_KEY = '__default';
const keyOf = (view: ColumnView | null) => view?.viewId ?? DEFAULT_KEY;

function useViewsModel(props: CustomToolPanelProps, showHidden: boolean) {
  const controller = (props.context as { columnViews: ColumnViewController }).columnViews;
  const { uuid } = controller;
  const { scope, columnView, gridState, modified, entry } = useTabColumnView(uuid);
  const views = useSavedColumnViewsStore((s) => s.views);
  const error = useSavedColumnViewsStore((s) => s.error);
  const presets = usePresetsStore((s) => s.presets);
  const notify = useContext(NotifyContext);

  useEffect(() => {
    void useSavedColumnViewsStore.getState().refresh();
  }, []);

  const columns = gridState?.columnOrder?.orderedColIds;
  const all = useMemo(
    () => (scope ? rankColumnViews(views, scope, columns ?? [], { showHidden: true }) : null),
    [views, scope, columns],
  );
  const ranked = useMemo(
    () =>
      all && {
        own: all.own.filter((v) => showHidden || !v.hidden),
        others: all.others.filter((r) => showHidden || !r.view.hidden),
      },
    [all, showHidden],
  );
  const hidden = all
    ? [
        ...all.own.filter((v) => v.hidden),
        ...all.others.filter((r) => r.view.hidden).map((r) => r.view),
      ]
    : [];
  const source = columnView?.viewId ? views.find((v) => v.viewId === columnView.viewId) : undefined;
  const scopeName =
    (scope?.presetId && presets.find((p) => p.presetId === scope.presetId)?.name) ||
    scope?.action ||
    '';
  const currentName = columnView?.name ?? ACTION_DEFAULT_NAME;
  const startId = entry?.viewId ?? null;
  const startName = entry?.name ?? ACTION_DEFAULT_NAME;
  const isCurrent = (view: ColumnView | null) =>
    columnView !== null && (columnView.viewId ?? null) === (view?.viewId ?? null);
  const isStart = (view: ColumnView | null) => startId === (view?.viewId ?? null);
  /** The preset or action a view was saved from (the action's key: no action names here). */
  const originOf = (view: ColumnView) =>
    (view.savedFrom.presetId &&
      presets.find((p) => p.presetId === view.savedFrom.presetId)?.name) ||
    view.savedFrom.action;

  const change = (what: string, run: (s: SavedColumnViewsState) => Promise<unknown>) => {
    run(useSavedColumnViewsStore.getState()).catch((e: unknown) => {
      notify?.(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`);
    });
  };

  const setStart = (view: ColumnView | null, notice?: string) => {
    if (!scope) return;
    const store = useAppliedViewsStore.getState();
    const done = view
      ? store.apply(scope, { viewId: view.viewId, name: view.name })
      : store.clear(scope);
    done
      .then(() =>
        notify?.(
          notice ?? `New "${scopeName}" tabs start with "${view?.name ?? ACTION_DEFAULT_NAME}".`,
        ),
      )
      .catch((e: unknown) => {
        notify?.(`Couldn't set it: ${e instanceof Error ? e.message : String(e)}`);
      });
  };

  const save = async (
    fields: Omit<ColumnViewFields, 'state'>,
    over: ColumnView | null,
    start?: boolean,
    startNotice?: (name: string) => string,
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
    if (start) setStart(saved, startNotice?.(saved.name));
  };

  /** Switches now; when that dropped unsaved changes, offers Undo in a snackbar. */
  const switchWithUndo = (view: ColumnView | null) => {
    const before = controller.current();
    const beforeView = useTabsStore.getState().tabs[uuid]?.state.columnView ?? null;
    controller.pick(view);
    if (!modified || !before) return;
    notify?.({
      message: `Switched to "${view?.name ?? ACTION_DEFAULT_NAME}". Your changes to "${currentName}" weren't saved.`,
      timeout: 10000,
      action: { label: 'Undo', onClick: () => controller.restore(before, beforeView) },
    });
  };

  return {
    controller,
    scope,
    columnView,
    modified,
    views,
    error,
    ranked,
    hidden,
    source,
    scopeName,
    currentName,
    startName,
    startId,
    isCurrent,
    isStart,
    originOf,
    change,
    setStart,
    save,
    switchWithUndo,
  };
}

type Model = ReturnType<typeof useViewsModel>;

/** The Save dialog, with "Start new tabs with it", then `after` once saved. */
function SaveDialog({
  m,
  after,
  onClose,
  terms = TERMS_A,
  fresh,
}: {
  m: Model;
  after?: () => void;
  onClose: () => void;
  terms?: Terms;
  /** Always a new view, starting from a blank name. */
  fresh?: boolean;
}) {
  return (
    <SaveColumnViewDialog
      source={fresh ? undefined : m.source}
      nameDecides={terms.inlineCurrent}
      startLabel={terms.saveStart(m.scopeName)}
      onSave={async (fields, over, start) => {
        await m.save(fields, over, start, (name) => terms.startNotice(name, m.scopeName));
        after?.();
      }}
      onClose={onClose}
    />
  );
}

function LoadError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
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
  );
}

interface MenuEntry {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/** A ⋯ menu; with `deleting`, its last item is Delete…, behind a confirm. */
function RowMenu({
  name,
  items,
  deleting,
}: {
  name: string;
  items: MenuEntry[];
  deleting?: ColumnView;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const close = () => setAnchor(null);
  return (
    <>
      <IconButton
        size="small"
        aria-label={`More for ${name}`}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <MoreHorizIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        {items.map((it) => (
          <MenuItem
            key={it.label}
            disabled={it.disabled}
            onClick={() => {
              close();
              it.onClick();
            }}
          >
            {it.label}
          </MenuItem>
        ))}
        {deleting?.owned && (
          <MenuItem
            onClick={() => {
              close();
              setConfirming(true);
            }}
          >
            Delete…
          </MenuItem>
        )}
      </Menu>
      {deleting && (
        <DeleteConfirm view={deleting} open={confirming} onClose={() => setConfirming(false)} />
      )}
    </>
  );
}

function DeleteConfirm({
  view,
  open,
  onClose,
}: {
  view: ColumnView;
  open: boolean;
  onClose: () => void;
}) {
  const notify = useContext(NotifyContext);
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Delete "{view.name}"?</DialogTitle>
      <DialogContent>
        {view.visibility === 'shared'
          ? 'Everyone loses it, not only you.'
          : 'It cannot be brought back.'}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          color="error"
          onClick={() => {
            onClose();
            useSavedColumnViewsStore
              .getState()
              .remove(view.viewId)
              .catch((e: unknown) => notify?.(`Couldn't delete it: ${String(e)}`));
          }}
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

// ---- Variant A: radio list, guard dialog, "New tabs" chip -----------------------------------

/** The words Variant A uses, so A and A2 differ only in them. */
interface Terms {
  /** No "This tab" header: the selected row says Edited, and Save/Discard show only then. */
  inlineCurrent?: boolean;
  /** Built-in in grey italics, with a line saying where it comes from and a divider after it. */
  builtInNote?: string;
  /** No disabled "Default" item: the default view offers this instead, Built-in nothing. */
  stopDefault?: string;
  builtIn: string;
  startChip: string;
  startMenu: (on: boolean) => string;
  startTooltip: (scope: string) => string;
  startNotice: (name: string, scope: string) => string;
  ownHeading: (scope: string) => string | null;
  othersHeading: string;
  othersSecondary: (origin: string, matching: number, total: number) => string;
  saveStart: (scope: string) => string;
}

const TERMS_A: Terms = {
  builtIn: ACTION_DEFAULT_NAME,
  startChip: 'New tabs',
  startMenu: (on) => (on ? 'New tabs start with this view' : 'Start new tabs with this view'),
  startTooltip: (scope) => `New "${scope}" tabs start with this view`,
  startNotice: (name, scope) => `New "${scope}" tabs start with "${name}".`,
  ownHeading: (scope) => `Views for "${scope}"`,
  othersHeading: 'Other views',
  othersSecondary: (_origin, matching, total) => `${matching} of ${total} columns match`,
  saveStart: (scope) => `Start new "${scope}" tabs with this view`,
};

const TERMS_A2: Terms = {
  inlineCurrent: true,
  builtInNote: "The action's own columns",
  stopDefault: 'Stop using as default',
  builtIn: 'Built-in',
  startChip: 'Default',
  startMenu: (on) => (on ? 'Default' : 'Make default'),
  startTooltip: (scope) => `Opens with this view whenever you run "${scope}"`,
  startNotice: (name, scope) => `"${scope}" now opens with "${name}".`,
  ownHeading: () => null,
  othersHeading: 'Saved elsewhere',
  othersSecondary: (origin, matching, total) => `From ${origin} · ${matching} of ${total} columns`,
  saveStart: (scope) => `Make it the default for "${scope}"`,
};

function VariantA({ terms, ...props }: CustomToolPanelProps & { terms: Terms }) {
  const [showHidden, setShowHidden] = useState(false);
  const m = useViewsModel(props, showHidden);
  const [pending, setPending] = useState<{ view: ColumnView | null } | null>(null);
  const [saving, setSaving] = useState<{ after?: () => void; fresh?: boolean } | null>(null);
  const currentName = m.columnView?.viewId ? m.currentName : terms.builtIn;

  const choose = (view: ColumnView | null) => {
    if (m.isCurrent(view)) return;
    if (m.modified) setPending({ view });
    else m.controller.pick(view);
  };

  const defaultItems = (view: ColumnView | null): MenuEntry[] => {
    const on = m.isStart(view);
    const make = {
      label: terms.startMenu(on),
      disabled: on,
      onClick: () => m.setStart(view, terms.startNotice(view?.name ?? terms.builtIn, m.scopeName)),
    };
    if (!terms.stopDefault || !on) return [make];
    const stop = terms.stopDefault;
    return view
      ? [
          {
            label: stop,
            onClick: () => m.setStart(null, terms.startNotice(terms.builtIn, m.scopeName)),
          },
        ]
      : [];
  };

  const row = (view: ColumnView | null, name: string, secondary?: ReactNode) => (
    <ListItem
      key={keyOf(view)}
      disablePadding
      secondaryAction={
        !view && defaultItems(view).length === 0 ? (
          <Box sx={{ width: 30 }} />
        ) : (
          <RowMenu
            name={name}
            deleting={view ?? undefined}
            items={[
              ...defaultItems(view),
              ...(view
                ? [
                    {
                      label: view.hidden ? 'Show in this list' : 'Hide from this list',
                      onClick: () =>
                        m.change('change it', (s) => s.setHidden(view.viewId, !view.hidden)),
                    },
                  ]
                : []),
            ]}
          />
        )
      }
    >
      <ListItemButton dense onClick={() => choose(view)} selected={m.isCurrent(view)}>
        <ListItemIcon sx={{ minWidth: 32 }}>
          <Radio
            size="small"
            edge="start"
            checked={m.isCurrent(view)}
            tabIndex={-1}
            disableRipple
          />
        </ListItemIcon>
        <ListItemText
          primary={name}
          secondary={
            terms.inlineCurrent && m.isCurrent(view) && m.modified ? (
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
              color: view?.hidden || (!view && terms.builtInNote) ? 'text.secondary' : undefined,
              sx: !view && terms.builtInNote ? { fontStyle: 'italic' } : undefined,
            },
          }}
        />
        {m.isStart(view) && (
          <Tooltip title={terms.startTooltip(m.scopeName)}>
            <Chip
              size="small"
              label={terms.startChip}
              color="primary"
              variant="outlined"
              sx={{ ml: 1 }}
            />
          </Tooltip>
        )}
      </ListItemButton>
    </ListItem>
  );

  return (
    <Box sx={{ width: '100%', overflowY: 'auto', p: 1 }} data-testid="views-tool-panel">
      {terms.inlineCurrent ? (
        m.modified ? (
          <Alert severity="warning" icon={false} sx={{ mb: 1, py: 0 }}>
            <Typography variant="body2">Your changes to "{currentName}" aren't saved.</Typography>
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
              <Button size="small" variant="contained" onClick={() => setSaving({})}>
                Save…
              </Button>
              <Button size="small" onClick={() => m.controller.revert()}>
                Discard
              </Button>
            </Stack>
          </Alert>
        ) : (
          <Button size="small" sx={{ mb: 1 }} onClick={() => setSaving({ fresh: true })}>
            Save as new view…
          </Button>
        )
      ) : (
        <>
          <Typography variant="overline" color="text.secondary">
            This tab
          </Typography>
          <Typography variant="subtitle2" noWrap>
            {currentName}
          </Typography>
          {m.modified ? (
            <Alert severity="info" icon={false} sx={{ my: 1, py: 0 }}>
              <Typography variant="body2">Unsaved changes</Typography>
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                <Button size="small" variant="contained" onClick={() => setSaving({})}>
                  Save…
                </Button>
                <Button size="small" onClick={() => m.controller.revert()}>
                  Discard
                </Button>
              </Stack>
            </Alert>
          ) : (
            <Button size="small" sx={{ my: 1 }} onClick={() => setSaving({})}>
              Save as a view…
            </Button>
          )}
        </>
      )}
      <LoadError error={m.error} />
      {m.ranked && (
        <List dense aria-label="Column views">
          {terms.ownHeading(m.scopeName) && (
            <ListSubheader disableSticky sx={{ lineHeight: 2 }}>
              {terms.ownHeading(m.scopeName)}
            </ListSubheader>
          )}
          {row(null, terms.builtIn, terms.builtInNote)}
          {terms.builtInNote && m.ranked.own.length > 0 && (
            <Divider component="li" sx={{ my: 0.5 }} />
          )}
          {m.ranked.own.map((v) => row(v, v.name))}
          {m.ranked.others.length > 0 && (
            <ListSubheader disableSticky sx={{ lineHeight: 2 }}>
              {terms.othersHeading}
            </ListSubheader>
          )}
          {m.ranked.others.map(({ view, matching, total }) =>
            row(view, view.name, terms.othersSecondary(m.originOf(view), matching, total)),
          )}
        </List>
      )}
      {m.hidden.length > 0 && (
        <Button size="small" onClick={() => setShowHidden(!showHidden)}>
          {showHidden
            ? "Don't show hidden views"
            : `Show ${plural(m.hidden.length, 'hidden view')}`}
        </Button>
      )}
      <Dialog open={pending !== null} onClose={() => setPending(null)} maxWidth="xs">
        <DialogTitle>Switch to "{pending?.view?.name ?? terms.builtIn}"?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Your changes to "{currentName}" aren't saved. Switching views replaces this tab's
            columns and filters.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)}>Cancel</Button>
          <Button
            color="warning"
            onClick={() => {
              m.controller.pick(pending!.view);
              setPending(null);
            }}
          >
            Discard and switch
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              const target = pending!.view;
              setPending(null);
              setSaving({ after: () => m.controller.pick(target) });
            }}
          >
            Save first…
          </Button>
        </DialogActions>
      </Dialog>
      {saving && (
        <SaveDialog
          m={m}
          terms={terms}
          after={saving.after}
          fresh={saving.fresh}
          onClose={() => setSaving(null)}
        />
      )}
    </Box>
  );
}

// ---- Variant B: two dropdowns, Undo snackbar, Manage dialog ---------------------------------

function VariantB(props: CustomToolPanelProps) {
  const m = useViewsModel(props, false);
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState(false);

  const byKey = new Map<string, ColumnView>(m.views.map((v) => [v.viewId, v]));
  const find = (key: string) => (key === DEFAULT_KEY ? null : (byKey.get(key) ?? null));
  const currentKey = m.columnView?.viewId ?? DEFAULT_KEY;
  const startValue = m.startId ?? DEFAULT_KEY;

  /** The options, with the current or start view kept even when hidden. */
  const options = (keep: string) => {
    if (!m.ranked) return [];
    const extra = m.hidden.filter((v) => v.viewId === keep);
    return [
      <MenuItem key={DEFAULT_KEY} value={DEFAULT_KEY}>
        {ACTION_DEFAULT_NAME}
      </MenuItem>,
      ...[...m.ranked.own, ...extra].map((v) => (
        <MenuItem key={v.viewId} value={v.viewId}>
          {v.name}
        </MenuItem>
      )),
      ...(m.ranked.others.length > 0
        ? [<ListSubheader key="others">Other views</ListSubheader>]
        : []),
      ...m.ranked.others.map(({ view, matching, total }) => (
        <MenuItem key={view.viewId} value={view.viewId}>
          <ListItemText primary={view.name} secondary={`${matching} of ${total} columns match`} />
        </MenuItem>
      )),
    ];
  };

  return (
    <Box sx={{ width: '100%', overflowY: 'auto', p: 1.5 }} data-testid="views-tool-panel">
      <LoadError error={m.error} />
      <Typography variant="overline" color="text.secondary">
        This tab
      </Typography>
      <TextField
        select
        fullWidth
        size="small"
        label="View"
        value={m.ranked ? currentKey : ''}
        onChange={(e) => m.switchWithUndo(find(e.target.value))}
        helperText={m.modified ? 'Unsaved changes' : ' '}
        slotProps={{ formHelperText: { sx: { color: m.modified ? 'warning.main' : undefined } } }}
      >
        {options(currentKey)}
      </TextField>
      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
        <Button
          size="small"
          variant={m.modified ? 'contained' : 'outlined'}
          onClick={() => setSaving(true)}
        >
          Save…
        </Button>
        <Button size="small" disabled={!m.modified} onClick={() => m.controller.revert()}>
          Discard changes
        </Button>
      </Stack>

      <Divider sx={{ my: 2 }} />

      <Typography variant="overline" color="text.secondary">
        New tabs
      </Typography>
      <TextField
        select
        fullWidth
        size="small"
        label={`New "${m.scopeName}" tabs start with`}
        value={m.ranked ? startValue : ''}
        onChange={(e) => m.setStart(find(e.target.value))}
        helperText="Only tabs you open from now on. This tab doesn't change."
      >
        {options(startValue)}
      </TextField>

      <Divider sx={{ my: 2 }} />

      <Button size="small" onClick={() => setManaging(true)}>
        Manage views…{m.hidden.length > 0 && ` (${m.hidden.length} hidden)`}
      </Button>

      <Dialog open={managing} onClose={() => setManaging(false)} fullWidth maxWidth="sm">
        <DialogTitle>Manage views</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 1 }}>
            Views you turn off here stay saved but aren't offered in this panel's lists.
          </DialogContentText>
          <List dense>
            {m.ranked &&
              [...m.ranked.own, ...m.hidden, ...m.ranked.others.map((r) => r.view)]
                .filter((v, i, a) => a.findIndex((w) => w.viewId === v.viewId) === i)
                .map((v) => (
                  <ListItem
                    key={v.viewId}
                    secondaryAction={
                      <Stack direction="row" sx={{ alignItems: 'center' }}>
                        <Switch
                          size="small"
                          checked={!v.hidden}
                          onChange={(e) =>
                            m.change('change it', (s) => s.setHidden(v.viewId, !e.target.checked))
                          }
                          slotProps={{ input: { 'aria-label': `Offer ${v.name}` } }}
                        />
                        <Typography variant="caption" sx={{ width: 56 }}>
                          {v.hidden ? 'Hidden' : 'Offered'}
                        </Typography>
                        {v.owned && <ManageDelete view={v} />}
                      </Stack>
                    }
                  >
                    <ListItemText
                      primary={v.name}
                      secondary={`${v.owned ? 'Yours' : v.owner}, ${v.visibility}`}
                    />
                  </ListItem>
                ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManaging(false)}>Done</Button>
        </DialogActions>
      </Dialog>
      {saving && <SaveDialog m={m} onClose={() => setSaving(false)} />}
    </Box>
  );
}

function ManageDelete({ view }: { view: ColumnView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton size="small" aria-label={`Delete ${view.name}`} onClick={() => setOpen(true)}>
        <DeleteIcon fontSize="small" />
      </IconButton>
      <DeleteConfirm view={view} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ---- Variant C: explicit Use buttons, inline confirm, star, Hidden accordion ----------------

function VariantC(props: CustomToolPanelProps) {
  const m = useViewsModel(props, false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [saving, setSaving] = useState<{ after?: () => void } | null>(null);

  const use = (view: ColumnView | null) => {
    if (m.modified) setConfirming(keyOf(view));
    else m.controller.pick(view);
  };

  const star = (view: ColumnView | null, name: string) => {
    const on = m.isStart(view);
    const tip = on
      ? view
        ? `New "${m.scopeName}" tabs start with "${name}". Click to start them with the action default.`
        : `New "${m.scopeName}" tabs start with the action default.`
      : `Start new "${m.scopeName}" tabs with "${name}"`;
    return (
      <Tooltip title={tip}>
        <IconButton
          size="small"
          aria-label={tip}
          aria-pressed={on}
          onClick={() => (on ? view && m.setStart(null) : m.setStart(view))}
        >
          {on ? <StarIcon fontSize="small" color="warning" /> : <StarBorderIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
    );
  };

  const row = (view: ColumnView | null, name: string, secondary?: string) => {
    const key = keyOf(view);
    const current = m.isCurrent(view);
    return (
      <Box key={key} sx={{ borderBottom: 1, borderColor: 'divider', py: 0.5 }}>
        <Stack direction="row" sx={{ alignItems: 'center' }}>
          {star(view, name)}
          <Box sx={{ flex: 1, minWidth: 0, px: 0.5 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: current ? 600 : undefined }}>
              {name}
            </Typography>
            {secondary && (
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {secondary}
              </Typography>
            )}
          </Box>
          {current ? (
            <Typography variant="caption" color="primary" sx={{ px: 1 }}>
              In this tab
            </Typography>
          ) : (
            <Button size="small" onClick={() => use(view)}>
              Use
            </Button>
          )}
          {view ? (
            <RowMenu
              name={name}
              deleting={view}
              items={[
                {
                  label: 'Hide from this list',
                  onClick: () => m.change('hide it', (s) => s.setHidden(view.viewId, true)),
                },
              ]}
            />
          ) : (
            <Box sx={{ width: 30 }} />
          )}
        </Stack>
        {confirming === key && (
          <Alert severity="warning" icon={false} sx={{ mt: 0.5, py: 0 }}>
            <Typography variant="body2">
              Your changes to "{m.currentName}" aren't saved. Using "{name}" replaces them.
            </Typography>
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  setConfirming(null);
                  setSaving({ after: () => m.controller.pick(view) });
                }}
              >
                Save first…
              </Button>
              <Button
                size="small"
                color="warning"
                onClick={() => {
                  setConfirming(null);
                  m.controller.pick(view);
                }}
              >
                Discard and use
              </Button>
              <Button size="small" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </Stack>
          </Alert>
        )}
      </Box>
    );
  };

  return (
    <Box sx={{ width: '100%', overflowY: 'auto', p: 1 }} data-testid="views-tool-panel">
      <Paper variant="outlined" sx={{ p: 1, mb: 2 }}>
        <Typography variant="overline" color="text.secondary">
          This tab
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle2" noWrap sx={{ flex: 1 }}>
            {m.currentName}
          </Typography>
          <Chip
            size="small"
            label={m.modified ? 'Unsaved changes' : 'Saved'}
            color={m.modified ? 'warning' : 'default'}
            variant="outlined"
          />
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ mt: 1 }}>
          <Button
            size="small"
            variant={m.modified ? 'contained' : 'outlined'}
            onClick={() => setSaving({})}
          >
            Save…
          </Button>
          {m.modified && (
            <Button size="small" onClick={() => m.controller.revert()}>
              Discard changes
            </Button>
          )}
        </Stack>
      </Paper>
      <LoadError error={m.error} />
      {m.ranked && (
        <>
          <Typography variant="subtitle2">Views for "{m.scopeName}"</Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
            <StarIcon sx={{ fontSize: 12, verticalAlign: 'middle' }} color="warning" /> New tabs
            start with the starred view.
          </Typography>
          {row(null, ACTION_DEFAULT_NAME)}
          {m.ranked.own.map((v) => row(v, v.name))}
          {m.ranked.others.length > 0 && (
            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              Other views
            </Typography>
          )}
          {m.ranked.others.map(({ view, matching, total }) =>
            row(view, view.name, `${matching} of ${total} columns match`),
          )}
        </>
      )}
      {m.hidden.length > 0 && (
        <Accordion disableGutters elevation={0} sx={{ mt: 2, '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0 }}>
            <Typography variant="body2" color="text.secondary">
              Hidden by you ({m.hidden.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0 }}>
            {m.hidden.map((v) => (
              <Stack key={v.viewId} direction="row" sx={{ alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1 }}>
                  {v.name}
                </Typography>
                <Button
                  size="small"
                  onClick={() => m.change('unhide it', (s) => s.setHidden(v.viewId, false))}
                >
                  Unhide
                </Button>
              </Stack>
            ))}
          </AccordionDetails>
        </Accordion>
      )}
      {saving && <SaveDialog m={m} after={saving.after} onClose={() => setSaving(null)} />}
    </Box>
  );
}
