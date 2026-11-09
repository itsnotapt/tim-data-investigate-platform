import DeleteIcon from '@mui/icons-material/Delete';
import ChevronRight from '@mui/icons-material/ChevronRight';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import ListItemButton from '@mui/material/ListItemButton';
import { keyframes } from '@mui/material/styles';
import { useEffect, useMemo, useState } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { titleOf } from '../action-tab/model';
import { selectAncestors, selectRoots, useTabsStore, type Tab, type TabsStore } from '../tabs';
import { TreeNodeIcon } from './TreeNodeIcon';
import { TreeNodeLabel } from './TreeNodeLabel';
import { useTreeSelection } from './useTreeSelection';

export const SIDE_TREE_COLLAPSED_WIDTH = 56;
const SIDE_TREE_EXPANDED_WIDTH = 700;

/** Opening is quick and a little slower than closing; both ease out. */
const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)';
const OPEN_MS = 110;
const CLOSE_MS = 80;

/** A row's chevron, checkbox and label slide in once the tree has started to open. */
const detailsIn = keyframes`
  from { opacity: 0; transform: translateX(-6px); }
  to { opacity: 1; transform: none; }
`;
const DETAILS_IN = {
  animation: `${detailsIn} 120ms 40ms ${EASE_OUT} backwards`,
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
};

export interface SideTreeProps {
  /** Override the tab store (tests). */
  store?: TabsStore;
}

/**
 * Query tree drawer (mini variant, expands on hover), below the action bar. The active node comes
 * straight from the route (`/view/:tabId`) on every render, so it is highlighted after a hard load
 * too. Rows and the header keep their height when it opens, so the icons don't move up or down.
 */
export function SideTree({ store = useTabsStore }: SideTreeProps) {
  const navigate = useNavigate();
  const activeTabId = useMatch('/view/:tabId')?.params.tabId;
  const tabs = store((s) => s.tabs);
  const order = store((s) => s.order);
  const lastCreated = store((s) => s.lastCreated);
  const [hover, setHover] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const selection = useTreeSelection(activeTabId, store);

  const { roots, children } = useMemo(() => {
    const data = { tabs, order };
    const byParent = new Map<string, Tab[]>();
    for (const id of order) {
      const t = tabs[id];
      if (t?.parentId != null && t.parentId in tabs) {
        byParent.set(t.parentId, [...(byParent.get(t.parentId) ?? []), t]);
      }
    }
    return { roots: selectRoots(data), children: byParent };
  }, [tabs, order]);

  // A new tab opens its ancestors. State adjusted during render.
  const [seenSeq, setSeenSeq] = useState(lastCreated?.seq ?? 0);
  if (lastCreated && lastCreated.seq !== seenSeq) {
    setSeenSeq(lastCreated.seq);
    const ancestors = selectAncestors({ tabs, order }, lastCreated.id);
    if (ancestors.some((a) => collapsed.has(a.id))) {
      const next = new Set(collapsed);
      for (const a of ancestors) next.delete(a.id);
      setCollapsed(next);
    }
  }

  // Results arriving on the active tab count as seen, and
  // opening a tab by URL marks it visited.
  const active = activeTabId ? tabs[activeTabId] : undefined;
  useEffect(() => {
    if (active && !active.visited && active.results !== null) {
      store.getState().markVisited(active.id);
    }
  }, [active, store]);

  const open = (t: Tab) => {
    store.getState().markVisited(t.id);
    if (t.id !== activeTabId) void navigate(`/view/${t.id}`);
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
    const kids = children.get(t.id) ?? [];
    const isOpen = kids.length > 0 && !collapsed.has(t.id);
    const isActive = t.id === activeTabId;
    return (
      <li key={t.id} style={{ listStyle: 'none' }}>
        <ListItemButton
          dense
          selected={isActive}
          data-testid={`tree-node-${t.id}`}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => open(t)}
          sx={{
            height: 40,
            py: 0,
            pl: expanded ? 1 + depth * 2 : 2,
            whiteSpace: 'nowrap',
            ...(isActive && { color: 'primary.main' }),
          }}
        >
          {expanded && (
            <IconButton
              size="small"
              aria-label={isOpen ? 'Collapse' : 'Expand'}
              sx={{ p: 0.5, ...DETAILS_IN, visibility: kids.length > 0 ? 'visible' : 'hidden' }}
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(t.id)) next.delete(t.id);
                  else next.add(t.id);
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
              sx={{ p: 0.5, ...DETAILS_IN }}
              checked={selection.checked.has(t.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => selection.toggle(t.id, e.target.checked)}
              slotProps={{ input: { 'aria-label': `Select ${titleOf(t)}` } }}
            />
          )}
          <Box sx={{ display: 'flex', mr: 1, ml: expanded ? 1 : 0 }}>
            <TreeNodeIcon tab={t} open={isOpen} active={isActive} />
          </Box>
          {expanded && (
            <Box sx={{ display: 'contents', '& > *': DETAILS_IN }}>
              <TreeNodeLabel tab={t} />
            </Box>
          )}
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
            transition: `width ${expanded ? OPEN_MS : CLOSE_MS}ms ${EASE_OUT}`,
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            position: 'absolute',
            zIndex: (theme) => theme.zIndex.drawer,
          },
        },
      }}
    >
      {/* Hidden, not removed, while collapsed, so the rows stay where they are when it opens. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          pl: 1,
          whiteSpace: 'nowrap',
          minWidth: 0,
          visibility: expanded ? 'visible' : 'hidden',
        }}
      >
        <Box component="span" sx={{ typography: 'overline', color: 'text.secondary', mr: 'auto' }}>
          Queries
        </Box>
        <IconButton
          aria-label="Remove selected"
          title="Remove selected"
          disabled={selection.checked.size === 0}
          onClick={() => void selection.removeSelected()}
        >
          <DeleteIcon />
        </IconButton>
      </Box>
      <Divider sx={{ visibility: expanded ? 'visible' : 'hidden' }} />
      <ul style={{ margin: 0, padding: 0 }}>{roots.map((r) => renderNode(r, 0))}</ul>
    </Drawer>
  );
}
