import SearchIcon from '@mui/icons-material/Search';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import InputAdornment from '@mui/material/InputAdornment';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useMemo, useState, type ReactNode } from 'react';
import type { TabsStore } from '../tabs';
import { TemplateSubMenu } from './TemplateSubMenu';
import { buildTemplateMenuTree } from './templateMenuTree';
import type { QueryOptions, QueryTemplate } from './types';
import { useNewQuery } from './useNewQuery';

export interface NewQueryMenuProps {
  /** Non-deleted templates (templates store). */
  templates: QueryTemplate[];
  /** Per-template options; `hide: true` removes a template from the menu. */
  queryOptions?: QueryOptions;
  /** Button content; default "New". */
  children?: ReactNode;
  /** Accessible name of the trigger (needed for icon-only triggers). */
  ariaLabel?: string;
  variant?: 'text' | 'outlined' | 'contained';
  size?: 'small' | 'medium' | 'large';
  /** Override the tab store (tests). */
  store?: TabsStore;
}

/** "New query" button + menu: ad-hoc query, search, Views and Queries submenus (screens 05, 06, 31). */
export function NewQueryMenu({
  templates,
  queryOptions,
  children = 'New',
  ariaLabel,
  variant = 'text',
  size = 'medium',
  store,
}: NewQueryMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState('');
  const { createAdHoc, createFromTemplate } = useNewQuery(store);
  const close = () => setAnchor(null);

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
        {[
          { title: 'Views', nodes: views },
          { title: 'Queries', nodes: queries },
        ]
          .filter((g) => g.nodes.length > 0)
          .map((g) => (
            <li key={g.title}>
              <TemplateSubMenu
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
