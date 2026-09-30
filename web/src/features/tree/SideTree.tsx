import DeleteIcon from '@mui/icons-material/Delete';
import ChevronRight from '@mui/icons-material/ChevronRight';
import ExpandMore from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import ListItemButton from '@mui/material/ListItemButton';
import { useEffect, useMemo, useState } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { NewQueryMenu, type NewQueryMenuProps } from '../new-query';
import { selectAncestors, selectRoots, useTabsStore, type Tab, type TabsStore } from '../tabs';
import { TreeNodeIcon } from './TreeNodeIcon';
import { TreeNodeLabel } from './TreeNodeLabel';
import { useTreeSelection } from './useTreeSelection';

export const SIDE_TREE_COLLAPSED_WIDTH = 56;
export const SIDE_TREE_EXPANDED_WIDTH = 700;

export interface SideTreeProps {
  templates: NewQueryMenuProps['templates'];
  queryOptions?: NewQueryMenuProps['queryOptions'];
  /** Called by the "Reload templates" button. Must handle its own errors (rejections are ignored). */
  onReloadTemplates: () => void | Promise<void>;
  /** Override the tab store (tests). */
  store?: TabsStore;
}

/**
 * Query tree drawer (mini variant, expands on hover). The active node comes straight from the
 * route (`/view/:uuid`) on every render, so it is highlighted after a hard load too (BUG-21).
 */
export function SideTree({
  templates,
  queryOptions,
  onReloadTemplates,
  store = useTabsStore,
}: SideTreeProps) {
  const navigate = useNavigate();
  const activeUuid = useMatch('/view/:uuid')?.params.uuid;
  const tabs = store((s) => s.tabs);
  const order = store((s) => s.order);
  const lastCreated = store((s) => s.lastCreated);
  const [hover, setHover] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const selection = useTreeSelection(activeUuid, store);

  const { roots, children } = useMemo(() => {
    const data = { tabs, order };
    const byParent = new Map<string, Tab[]>();
    for (const id of order) {
      const t = tabs[id];
      if (t?.parentUuid != null && t.parentUuid in tabs) {
        byParent.set(t.parentUuid, [...(byParent.get(t.parentUuid) ?? []), t]);
      }
    }
    return { roots: selectRoots(data), children: byParent };
  }, [tabs, order]);

  // A new tab opens its ancestors (legacy `new:display-component`). State adjusted during render.
  const [seenSeq, setSeenSeq] = useState(lastCreated?.seq ?? 0);
  if (lastCreated && lastCreated.seq !== seenSeq) {
    setSeenSeq(lastCreated.seq);
    const ancestors = selectAncestors({ tabs, order }, lastCreated.uuid);
    if (ancestors.some((a) => collapsed.has(a.componentUuid))) {
      const next = new Set(collapsed);
      for (const a of ancestors) next.delete(a.componentUuid);
      setCollapsed(next);
    }
  }

  // Results arriving on the active tab count as seen (legacy `update:kusto-results`), and
  // opening a tab by URL marks it visited.
  const active = activeUuid ? tabs[activeUuid] : undefined;
  useEffect(() => {
    if (active && !active.state.isVisited && active.state.rowCount !== null) {
      store.getState().markVisited(active.componentUuid);
    }
  }, [active, store]);

  const open = (t: Tab) => {
    store.getState().markVisited(t.componentUuid);
    if (t.componentUuid !== activeUuid) void navigate(`/view/${t.componentUuid}`);
  };

  // mouseleave is lost when the pointer was over a portalled menu item that closed under it
  // (the browser has no element to send mouseout to), which left the tree expanded.
  useEffect(() => {
    if (!hover) return;
    const onMove = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest('[aria-label="Query tree"], [role="presentation"]')) setHover(false);
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, [hover]);

  const expanded = hover;
  const width = expanded ? SIDE_TREE_EXPANDED_WIDTH : SIDE_TREE_COLLAPSED_WIDTH;

  const renderNode = (t: Tab, depth: number) => {
    const kids = children.get(t.componentUuid) ?? [];
    const isOpen = kids.length > 0 && !collapsed.has(t.componentUuid);
    const isActive = t.componentUuid === activeUuid;
    return (
      <li key={t.componentUuid} style={{ listStyle: 'none' }}>
        <ListItemButton
          dense
          selected={isActive}
          data-testid={`tree-node-${t.componentUuid}`}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => open(t)}
          sx={{
            minHeight: 40,
            pl: expanded ? 1 + depth * 2 : 2,
            whiteSpace: 'nowrap',
            ...(isActive && { color: 'primary.main' }),
          }}
        >
          {expanded && (
            <IconButton
              size="small"
              aria-label={isOpen ? 'Collapse' : 'Expand'}
              sx={{ visibility: kids.length > 0 ? 'visible' : 'hidden' }}
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(t.componentUuid)) next.delete(t.componentUuid);
                  else next.add(t.componentUuid);
                  return next;
                });
              }}
            >
              {isOpen ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
            </IconButton>
          )}
          {expanded && (
            <Checkbox
              size="small"
              checked={selection.checked.has(t.componentUuid)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => selection.toggle(t.componentUuid, e.target.checked)}
              slotProps={{ input: { 'aria-label': `Select ${t.title}` } }}
            />
          )}
          <Box sx={{ display: 'flex', mr: 1 }}>
            <TreeNodeIcon tab={t} open={isOpen} active={isActive} />
          </Box>
          {expanded && <TreeNodeLabel tab={t} />}
        </ListItemButton>
        {isOpen && (
          <ul style={{ margin: 0, padding: 0 }}>{kids.map((k) => renderNode(k, depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <Drawer
      variant="permanent"
      anchor="left"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      sx={{ width: SIDE_TREE_COLLAPSED_WIDTH, flexShrink: 0 }}
      slotProps={{
        paper: {
          'aria-label': 'Query tree',
          sx: {
            width,
            overflowX: 'hidden',
            transition: 'width 150ms ease',
            position: 'absolute',
            zIndex: (theme) => theme.zIndex.drawer,
          },
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', pl: 1, whiteSpace: 'nowrap', minWidth: 0 }}>
        <NewQueryMenu
          templates={templates}
          queryOptions={queryOptions}
          ariaLabel="New query"
          store={store}
        >
          <AddIcon />
        </NewQueryMenu>
        <IconButton
          aria-label="Reload templates"
          title="Reload templates"
          onClick={() => {
            void Promise.resolve(onReloadTemplates()).catch(() => undefined);
          }}
        >
          <RefreshIcon />
        </IconButton>
        <IconButton
          aria-label="Remove selected"
          title="Remove selected"
          disabled={selection.checked.size === 0}
          onClick={() => void selection.removeSelected()}
        >
          <DeleteIcon />
        </IconButton>
      </Box>
      <Divider />
      <ul style={{ margin: 0, padding: 0 }}>{roots.map((r) => renderNode(r, 0))}</ul>
    </Drawer>
  );
}
