import SearchIcon from '@mui/icons-material/Search';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import InputAdornment from '@mui/material/InputAdornment';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useMemo, useState, type ReactNode } from 'react';
import type { CatalogueAction } from '../../lib/api';
import { useInstanceStore } from '../instance';
import type { TabsStore } from '../tabs';
import { SubMenu } from './SubMenu';
import { buildActionMenuTree, buildTemplateMenuTree } from './menuTree';
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
}

const NO_ACTIONS: readonly CatalogueAction[] = [];

/**
 * "New query" button + menu: ad-hoc query, search, then Actions (under their menu paths), Views and
 * Queries submenus (screens 05, 06, 31).
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
}: NewQueryMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState('');
  const { createAdHoc, createFromTemplate, createFromAction } = useNewQuery(store);
  const instanceActions = useInstanceStore((s) => s.instance?.actions ?? NO_ACTIONS);
  const close = () => setAnchor(null);

  const actionNodes = useMemo(
    () => buildActionMenuTree(actions ?? instanceActions, search),
    [actions, instanceActions, search],
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

  return (
    <>
      <Button
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={anchor ? true : undefined}
        variant={variant}
        size={size}
        onClick={(e) => setAnchor(e.currentTarget)}
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
        {actionNodes.length > 0 && (
          <li>
            <SubMenu
              title="Actions"
              nodes={actionNodes}
              forceOpen={searching}
              onSelect={(a) => {
                createFromAction(a);
                close();
              }}
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
    </>
  );
}
