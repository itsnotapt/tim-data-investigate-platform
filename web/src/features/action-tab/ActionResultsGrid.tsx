import type { GridApi, GridReadyEvent } from 'ag-grid-community';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogueColumn, RunColumn, RunRow } from '../../lib/api';
import { prepareRows, type GridRowWithId } from '../grid/columns';
import { ResultsGrid, type ResultsGridProps } from '../grid/ResultsGrid';
import { useRowResults } from '../grid/useRowResults';
import { buildActionColumnDefs } from './actionColumns';

/** The grid row id: the run's row ordinal. */
const ROW_ID = 'row';

export type ActionResultsGridProps = Omit<
  ResultsGridProps,
  'rows' | 'templateColumns' | 'columnId' | 'columnDefs' | 'stateKey'
> & {
  uuid: string;
  /** The rows to show. Rows that continue the ones shown are added to them, as each page loads. */
  rows: readonly RunRow[];
  /** The action's declared columns. */
  declaredColumns?: readonly CatalogueColumn[] | null;
  /** The columns of the run the rows came from. */
  runColumns?: readonly RunColumn[] | null;
};

/** Whether `next` is `shown` with more rows after it (pages append; a reload gives new objects). */
const continues = (shown: readonly RunRow[], next: readonly RunRow[]) =>
  shown.length > 0 && next.length > shown.length && next[shown.length - 1] === shown.at(-1);

/** An action tab's rows, keyed by `row`, with the action's columns. */
export function ActionResultsGrid({
  uuid,
  rows,
  declaredColumns,
  runColumns,
  onGridReady,
  ...rest
}: ActionResultsGridProps) {
  const columnDefs = useMemo(
    () => buildActionColumnDefs(declaredColumns, runColumns),
    [declaredColumns, runColumns],
  );
  // The grid is given `given` as its row data; rows that continue them go in by transaction, so a
  // page doesn't make the grid take every row again.
  const [given, setGiven] = useState(rows);
  const shown = useRef(rows);
  const api = useRef<GridApi<GridRowWithId> | null>(null);
  useEffect(() => {
    if (rows === shown.current) return;
    if (api.current && continues(shown.current, rows)) {
      const added = rows.slice(shown.current.length);
      api.current.applyTransaction({ add: prepareRows(added, ROW_ID) });
    } else {
      setGiven(rows);
    }
    shown.current = rows;
  }, [rows]);
  const ready = useCallback(
    (e: GridReadyEvent<GridRowWithId>) => {
      api.current = e.api;
      onGridReady?.(e);
    },
    [onGridReady],
  );
  return (
    <ResultsGrid
      {...rest}
      stateKey={uuid}
      rows={given}
      columnId={ROW_ID}
      columnDefs={columnDefs}
      onGridReady={ready}
    />
  );
}

export type StoredActionResultsGridProps = Omit<ActionResultsGridProps, 'rows'> & {
  /** The tab's `rowDataTrigger`: the rows are read again from `row_results` when it changes. */
  rowDataTrigger: number | null;
};

/** An action tab's rows from `row_results`, its durable copy. */
export function StoredActionResultsGrid({
  rowDataTrigger,
  ...props
}: StoredActionResultsGridProps) {
  const { rows } = useRowResults(props.uuid, rowDataTrigger);
  return <ActionResultsGrid {...props} rows={rows as unknown as RunRow[]} />;
}
