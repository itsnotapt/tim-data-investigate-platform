import { useTabsStore, type TabsStore } from '../tabs';

/**
 * Clones an action tab as a sibling titled "Copy of <title>", with its params, the rows it was
 * pivoted from and its Id column, and not run.
 */
export function cloneActionTab(uuid: string, store: TabsStore = useTabsStore): string | null {
  const tab = store.getState().tabs[uuid];
  if (tab?.componentName !== 'ActionResult') return null;
  const { idColumn } = tab.state;
  const { pivotRows } = tab.params;
  return store.getState().createTab({
    componentName: 'ActionResult',
    parentUuid: tab.parentUuid,
    title: `Copy of ${tab.title}`,
    params: {
      action: tab.params.action,
      params: JSON.parse(JSON.stringify(tab.params.params)) as Record<string, unknown>,
      ...(pivotRows && {
        pivotRows: JSON.parse(JSON.stringify(pivotRows)) as Record<string, unknown>[],
      }),
    },
    ...(idColumn !== undefined && { state: { idColumn } }),
  });
}
