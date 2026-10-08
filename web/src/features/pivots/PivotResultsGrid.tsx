import { TabResultsGrid } from '../grid';
import type { TabsStore } from '../tabs';
import { TagDialogProvider, useTaggingMenu } from '../tagging';
import { usePivotMenu } from './usePivotMenu';

/** Grid with the tagging and pivot menus; needs `TagDialogProvider` above it. */
function PivotGrid({ uuid, store }: { uuid: string; store?: TabsStore }) {
  const pivots = usePivotMenu(uuid, store);
  const tagging = useTaggingMenu(uuid, undefined, store);
  // First group holds tagging and Show details; pivots follow a separator.
  return <TabResultsGrid uuid={uuid} getContextMenuItems={[tagging, pivots]} />;
}

/** `TabResultsGrid` whose context menu pivots through the query templates into child tabs. */
export function PivotResultsGrid({ uuid, store }: { uuid: string; store?: TabsStore }) {
  return (
    <TagDialogProvider>
      <PivotGrid uuid={uuid} store={store} />
    </TagDialogProvider>
  );
}
