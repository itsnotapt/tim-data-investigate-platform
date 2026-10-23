import SearchIcon from '@mui/icons-material/Search';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import InputAdornment from '@mui/material/InputAdornment';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { useContext, useMemo, useState, type ReactNode } from 'react';
import { NotifyContext } from '../../components/notifyContext';
import type { CatalogueAction, Preset } from '../../lib/api';
import { useInstanceStore } from '../instance';
import {
  presetFields,
  presetValues,
  SavePresetDialog,
  usePresetsStore,
  type PresetsState,
  type PresetsStore,
} from '../presets';
import type { TabsStore } from '../tabs';
import { PresetMoreMenu } from './PresetMoreMenu';
import { SubMenu } from './SubMenu';
import {
  buildNewMenuTree,
  buildTemplateMenuTree,
  entryCaption,
  type NewMenuEntry,
  type NewMenuFilter,
} from './menuTree';
import type { QueryOptions, QueryTemplate } from './types';
import { useNewQuery } from './useNewQuery';

export interface NewQueryMenuProps {
  /** Non-deleted templates (templates store). */
  templates: QueryTemplate[];
  /** Per-template options; `hide: true` removes a template from the menu. */
  queryOptions?: QueryOptions;
  /** The instance's actions; defaults to the instance store's. */
  actions?: readonly CatalogueAction[];
  /** Button content; default "New". */
  children?: ReactNode;
  /** Accessible name of the trigger (needed for icon-only triggers). */
  ariaLabel?: string;
  variant?: 'text' | 'outlined' | 'contained';
  size?: 'small' | 'medium' | 'large';
  /** Override the tab store (tests). */
  store?: TabsStore;
  /** Override the presets store (tests). */
  presetsStore?: PresetsStore;
}

const NO_ACTIONS: readonly CatalogueAction[] = [];

const FILTERS: readonly [NewMenuFilter, string][] = [
  ['all', 'All'],
  ['mine', 'Mine'],
  ['others', "Others'"],
  ['hidden', 'Hidden'],
];

/**
 * "New query" button + menu: a Kusto tab, search, the presets filter, then actions and presets in
 * one tree of folders, and the Views and Queries submenus (screens 05, 06, 31). The presets are
 * refetched each time the menu opens.
 */
export function NewQueryMenu({
  templates,
  queryOptions,
  actions,
  children = 'New',
  ariaLabel,
  variant = 'text',
  size = 'medium',
  store,
  presetsStore = usePresetsStore,
}: NewQueryMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<NewMenuFilter>('all');
  const [editing, setEditing] = useState<{ preset: Preset; action: CatalogueAction } | null>(null);
  const { createAdHoc, createFromTemplate, createFromAction, createFromPreset } =
    useNewQuery(store);
  const instanceActions = useInstanceStore((s) => s.instance?.actions ?? NO_ACTIONS);
  const presets = presetsStore((s) => s.presets);
  const notify = useContext(NotifyContext);
  const close = () => setAnchor(null);

  const actionNodes = useMemo(
    () => buildNewMenuTree(actions ?? instanceActions, presets, { search, filter }),
    [actions, instanceActions, presets, search, filter],
  );
  const views = useMemo(
    () => buildTemplateMenuTree(templates, { queryType: 'view', search, queryOptions }),
    [templates, search, queryOptions],
  );
  const queries = useMemo(
    () => buildTemplateMenuTree(templates, { queryType: 'query', search, queryOptions }),
    [templates, search, queryOptions],
  );
  const searching = search.trim() !== '';

  const open = (entry: NewMenuEntry) => {
    if (entry.kind === 'action') createFromAction(entry.action);
    else if (entry.action) createFromPreset(entry.preset, entry.action);
    else return;
    close();
  };
  /** Runs a change to a preset, and says so when it fails. */
  const change = (what: string, run: (s: PresetsState) => Promise<unknown>) => {
    run(presetsStore.getState()).catch((e: unknown) => {
      notify?.(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`);
    });
  };
  const moreMenu = (entry: NewMenuEntry) => {
    if (entry.kind !== 'preset') return null;
    const { preset } = entry;
    const id = preset.presetId;
    return (
      <PresetMoreMenu
        preset={preset}
        owned={preset.owned}
        canOpen={entry.action !== undefined}
        onOpen={() => open(entry)}
        onEdit={() => entry.action && setEditing({ preset, action: entry.action })}
        onDuplicate={() =>
          change('duplicate it', (s) =>
            s.create({
              ...presetFields(preset),
              name: `Copy of ${preset.name}`,
              visibility: 'private',
            }),
          )
        }
        onVisibility={(visibility) =>
          change('change who sees it', (s) =>
            s.replace(id, { ...presetFields(preset), visibility }),
          )
        }
        onDelete={() => change('delete it', (s) => s.remove(id))}
        onHidden={(hidden) =>
          change(hidden ? 'hide it' : 'unhide it', (s) => s.setHidden(id, hidden))
        }
      />
    );
  };

  return (
    <>
      <Button
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={anchor ? true : undefined}
        variant={variant}
        size={size}
        onClick={(e) => {
          setAnchor(e.currentTarget);
          void presetsStore.getState().refresh();
        }}
      >
        {children}
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close} autoFocus={false}>
        <MenuItem
          onClick={() => {
            createAdHoc();
            close();
          }}
        >
          New query
        </MenuItem>
        <Divider component="li" />
        <li style={{ padding: '4px 16px' }}>
          <TextField
            size="small"
            fullWidth
            autoFocus
            placeholder="Search queries"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // Keep MUI Menu type-ahead from stealing keystrokes.
            onKeyDown={(e) => e.stopPropagation()}
            slotProps={{
              htmlInput: { 'aria-label': 'Search queries' },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        </li>
        <li style={{ padding: '4px 16px' }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            fullWidth
            aria-label="Show presets"
            value={filter}
            onChange={(_, value: NewMenuFilter | null) => value && setFilter(value)}
          >
            {FILTERS.map(([value, label]) => (
              <ToggleButton key={value} value={value}>
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </li>
        {actionNodes.length > 0 && (
          <li>
            <SubMenu
              title="Actions and presets"
              nodes={actionNodes}
              forceOpen={searching}
              onSelect={open}
              caption={entryCaption}
              itemAction={moreMenu}
            />
          </li>
        )}
        {[
          { title: 'Views', nodes: views },
          { title: 'Queries', nodes: queries },
        ]
          .filter((g) => g.nodes.length > 0)
          .map((g) => (
            <li key={g.title}>
              <SubMenu
                title={g.title}
                nodes={g.nodes}
                forceOpen={searching}
                onSelect={(t) => {
                  createFromTemplate(t);
                  close();
                }}
              />
            </li>
          ))}
      </Menu>
      {editing && (
        <SavePresetDialog
          action={editing.action}
          params={presetValues(editing.preset)}
          source={editing.preset}
          store={presetsStore}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
