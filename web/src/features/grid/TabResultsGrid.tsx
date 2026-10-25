import { useMemo } from 'react';
import { useTabsStore } from '../tabs';
import { useCommentEdit } from '../tagging/commentEdit';
import { ResultsGrid } from './ResultsGrid';
import type { ResultsGridProps } from './ResultsGrid';
import { useRowResults } from './useRowResults';

type TabGridProps = Omit<ResultsGridProps, 'rows' | 'columnId' | 'stats'> & {
  uuid: string;
};

/** Grid bound to a tab: rows from IndexedDB (reloaded on `rowDataTrigger`), stats from the store. */
export function TabResultsGrid({ uuid, ...rest }: TabGridProps) {
  const tab = useTabsStore((s) => s.tabs[uuid]);
  const { rows } = useRowResults(uuid, tab?.rowDataTrigger);

  const state = tab?.state;
  const stats = useMemo(
    () => ({
      executionTime: state?.executionTime,
      cpuUsage: state?.cpuUsage,
      memoryUsage: state?.memoryUsage,
    }),
    [state?.executionTime, state?.cpuUsage, state?.memoryUsage],
  );

  const onCellEditRequest = useCommentEdit(uuid);
  return (
    <ResultsGrid
      {...rest}
      onCellEditRequest={rest.onCellEditRequest ?? onCellEditRequest}
      stateKey={rest.stateKey ?? uuid}
      rows={rows}
      stats={stats}
    />
  );
}
