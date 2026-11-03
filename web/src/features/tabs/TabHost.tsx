import Box from '@mui/material/Box';
import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router';
import { touchLru } from './lru';
import { tabRegistry as defaultRegistry, type TabRegistry } from './tabRegistry';
import { useTabsStore } from './tabStore';

/**
 * Renders the tab at `/view/:uuid`. Visited tabs stay mounted (hidden with display:none) so
 * their grids keep their scroll position, focused cell, selection and column state. Unknown uuids
 * redirect home, but only after tabs finished loading (a hard load must not bounce before
 * IndexedDB is read).
 */
export function TabHost({ registry = defaultRegistry }: { registry?: TabRegistry }) {
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
        const tab = tabs[id];
        if (!tab) return null; // removed since it was visited
        const Component = registry[tab.componentName];
        return (
          <Box key={id} sx={{ display: id === uuid ? 'block' : 'none' }}>
            <Component uuid={id} />
          </Box>
        );
      })}
    </>
  );
}
