import { useMemo } from 'react';
import { useTabsStore } from '../tabs';
import { useCommentEdit } from '../tagging/commentEdit';
import { ResultsGrid } from './ResultsGrid';
import type { ResultsGridProps } from './ResultsGrid';
import { useRowResults } from './useRowResults';
import type { TemplateColumns } from './columns';

type TabGridProps = Omit<ResultsGridProps, 'rows' | 'templateColumns' | 'columnId' | 'stats'> & {
  uuid: string;
};

/** Grid bound to a tab: rows from IndexedDB (reloaded on `rowDataTrigger`), template + stats from the store. */
export function TabResultsGrid({ uuid, ...rest }: TabGridProps) {
  const tab = useTabsStore((s) => s.tabs[uuid]);
  const { rows } = useRowResults(uuid, tab?.rowDataTrigger);

  const template =
    tab?.componentName === 'TemplateQueryResult'
      ? (tab.params.queryTemplate as { columns?: TemplateColumns; columnId?: string | null })
      : undefined;
  const state = tab?.state;
  const stats = useMemo(
    () => ({
      executionTime: state?.executionTime,
      cpuUsage: state?.cpuUsage,
      memoryUsage: state?.memoryUsage,
    }),
    [state?.executionTime, state?.cpuUsage, state?.memoryUsage],
  );

  // Legacy (KustoPivot.vue:180) treated a missing or array `columns` as no overrides.
  const onCellEditRequest = useCommentEdit(uuid, template?.columnId);
  const columns = template?.columns && !Array.isArray(template.columns) ? template.columns : null;
  return (
    <ResultsGrid
      {...rest}
      onCellEditRequest={rest.onCellEditRequest ?? onCellEditRequest}
      stateKey={rest.stateKey ?? uuid}
      rows={rows}
      templateColumns={columns}
      columnId={template?.columnId}
      stats={stats}
    />
  );
}
