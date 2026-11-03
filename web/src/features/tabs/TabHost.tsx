import Box from '@mui/material/Box';
import { useEffect, useState, type ComponentType } from 'react';
import { Navigate, useParams } from 'react-router';
import { touchLru } from './lru';
import { ActionTab } from '../action-tab/ActionTab';
import { useTabsStore } from './tabStore';

/**
 * Renders the tab at `/view/:uuid`. Visited tabs stay mounted (hidden with display:none) so
 * their grids keep their scroll position, focused cell, selection and column state. Unknown uuids
 * redirect home, but only after tabs finished loading (a hard load must not bounce before
 * IndexedDB is read).
 */
export function TabHost({
  component: Component = ActionTab,
}: {
  /** What shows a tab (default `ActionTab`); tests put a probe in its place. */
  component?: ComponentType<{ uuid: string }>;
}) {
  const { uuid = '' } = useParams();
  const tabs = useTabsStore((s) => s.tabs);
  const loaded = useTabsStore((s) => s.loaded);
  const [mounted, setMounted] = useState<string[]>([]);

  const known = uuid in tabs;
  // Adjust state during render so the active tab is in the first committed output.
  if (known && mounted[mounted.length - 1] !== uuid) setMounted(touchLru(mounted, uuid));

  useEffect(() => {
    if (known) useTabsStore.getState().markVisited(uuid);
  }, [known, uuid]);

  if (loaded && !known) return <Navigate to="/" replace />;

  return (
    <>
      {/* In a fixed order, by uuid, so a visit never moves a tab's node (docs/architecture.md). */}
      {[...mounted].sort().map((id) => {
        if (!tabs[id]) return null; // removed since it was visited
        return (
          <Box key={id} sx={{ display: id === uuid ? 'block' : 'none' }}>
            <Component uuid={id} />
          </Box>
        );
      })}
    </>
  );
}
