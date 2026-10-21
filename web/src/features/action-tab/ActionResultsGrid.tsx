import { useMemo } from 'react';
import type { CatalogueColumn, RunColumn } from '../../lib/api';
import { ResultsGrid, type ResultsGridProps } from '../grid/ResultsGrid';
import { useRowResults } from '../grid/useRowResults';
import { buildActionColumnDefs } from './actionColumns';

export type ActionResultsGridProps = Omit<
  ResultsGridProps,
  'rows' | 'templateColumns' | 'columnId' | 'columnDefs' | 'stateKey'
> & {
  uuid: string;
  /** The tab's `rowDataTrigger`: the rows are reloaded from IndexedDB when it changes. */
  rowDataTrigger: number | null;
  /** The action's declared columns. */
  declaredColumns?: readonly CatalogueColumn[] | null;
  /** The columns of the run the rows came from. */
  runColumns?: readonly RunColumn[] | null;
};

/** An action tab's rows from `row_results`, keyed by `row`, with the action's columns. */
export function ActionResultsGrid({
  uuid,
  rowDataTrigger,
  declaredColumns,
  runColumns,
  ...rest
}: ActionResultsGridProps) {
  const { rows } = useRowResults(uuid, rowDataTrigger);
  const columnDefs = useMemo(
    () => buildActionColumnDefs(declaredColumns, runColumns),
    [declaredColumns, runColumns],
  );
  return (
    <ResultsGrid {...rest} stateKey={uuid} rows={rows} columnId="row" columnDefs={columnDefs} />
  );
}
