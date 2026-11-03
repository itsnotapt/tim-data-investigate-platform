import Box from '@mui/material/Box';
import type {
  CellKeyDownEvent,
  FullWidthCellKeyDownEvent,
  GetMainMenuItems,
  GridApi,
  GridReadyEvent,
  GridState,
} from 'ag-grid-community';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NotifyContext } from '../../components/notifyContext';
import { getAnnotationStore, pollAnnotationsSoon } from '../../lib/annotations';
import type { CatalogueColumn, InstanceLabel, RunRow } from '../../lib/api';
import {
  ACTION_SIDE_BAR,
  ACTION_STATUS_PANELS,
  actionFileColumns,
  copyColumnSettingsItem,
  useActionColumnView,
} from '../action-column-views';
import { useAnalyst } from '../analyst';
import { annotationColumnDefs, saveComment, useAnnotating, useRowDetail } from '../annotate';
import type { GridRowWithId } from '../grid/columns';
import { SELECTION_COLUMN_ID, type GetExtraContextMenuItems } from '../grid/gridOptions';
import { ResultsGrid, type ResultsGridProps } from '../grid/ResultsGrid';
import { useInstanceStore } from '../instance';
import {
  buildLabelMenu,
  labelClassRules,
  labelColumnDef,
  LabelSymbol,
  makeLabelKeys,
  targetRows,
  type LabelMenuOptions,
} from '../labels';
import { copyShareLink } from '../share-links';
import { buildSinkMenu, useSinks } from '../sinks';
import { buildActionColumnDefs } from './actionColumns';
import { GoToPivotRow } from './GoToPivotRow';
import { resultsOf, subscribeResults, type Results, type ResultsChange } from './results';
import { RoundedColumnsContext, roundedColumns } from './roundedColumns';

const NO_LABELS: readonly InstanceLabel[] = [];
/** `maxAnnotationIds` until the instance says otherwise. */
const DEFAULT_MAX_IDS = 10_000;

export type ActionResultsGridProps = Omit<
  ResultsGridProps,
  | 'rows'
  | 'columnDefs'
  | 'sideBar'
  | 'statusPanels'
  | 'context'
  | 'onStateUpdated'
  | 'rowClassRules'
  | 'selectionSymbol'
  | 'onCellKeyDown'
  | 'onCellFocused'
> & {
  tabId: string;
  /** The tab's Results, as they are now: the grid applies each change to them as it comes. */
  results: Results;
  /** Called with the column a cell's Use … as Id column picks. */
  onIdColumnChange?: (column: string) => void;
  /** The action's declared columns. */
  declaredColumns?: readonly CatalogueColumn[] | null;
  /** More context menu items, after Label ▸, Annotate…, Comment… and Row detail, before the sinks. */
  getContextMenuItems?: GetExtraContextMenuItems;
  /** The Id column Copy link carries: `idColumn` when it isn't the one the run opens with. */
  linkIdColumn?: string | null;
  /** The row a share link named: focused, with Row detail open on it, once it has arrived. */
  linkedRow?: number | null;
  /** Called once the linked row is focused. */
  onLinkedRowShown?: () => void;
  /** The `id`s of the pivot rows the tab was pivoted from, each `null` for a row without one. */
  pivotRowIds?: readonly (string | null)[] | null;
  /** Whether the action finds pivot rows: with `pivotRowIds`, the grid shows Go to pivot row. */
  findPivotRows?: boolean;
};

/** Applies a change to the tab's Results to the grid. */
function applyChange(grid: GridApi<GridRowWithId>, change: ResultsChange, results: Results): void {
  switch (change.type) {
    case 'added':
      grid.applyTransaction({ add: [...change.rows] });
      return;
    case 'replaced':
      // The grid matches the rows by row id, so it updates those it has in place.
      grid.setGridOption('rowData', [...results.rows]);
      return;
    case 'annotated': {
      const nodes = grid.applyTransaction({ update: [...change.rows] })?.update ?? [];
      // The symbol has no value of its own, so its cells are redrawn.
      grid.refreshCells({ rowNodes: nodes, columns: [SELECTION_COLUMN_ID], force: true });
      if (change.source === 'feed' && nodes.length > 0) grid.flashCells({ rowNodes: nodes });
      return;
    }
    case 'loaded':
      return;
  }
}

/**
 * An action tab's Results, keyed by `row`, with the action's columns and the annotations of each
 * row's `id`, the value of its Id column. Each page that arrives is added to the rows; when the Id
 * column changes, the rows take their new ids and those ids' annotations in place. Either way the
 * grid keeps the selection, filters, sort and scroll. A cell's Use … as Id column asks for its
 * column to be the Id column. The annotations show the label's fill, stripe and
 * symbol, the comments column, the hidden Label, Tags and Comment text columns, Label ▸, Annotate…,
 * Comment…, Row detail and their keys, the Row detail side panel, the sinks, which take the rows,
 * Copy column settings, and Copy link to the right-clicked row.
 * The annotations come from the annotation store, never from `row_results`; a teammate's change
 * from the feed flashes the rows it changes.
 * The columns, sorting, grouping and filters follow the tab's column view: the Views panel of the
 * side bar, with the view's name in the status bar.
 * The row a share link named is focused, with Row detail open on it, once it has arrived.
 * A tab pivoted into an action that finds pivot rows shows Go to pivot row over the grid.
 * A `number` column's header warns when it holds whole numbers beyond ±(2^53 − 1), which round.
 */
export function ActionResultsGrid({
  tabId,
  results,
  onIdColumnChange,
  declaredColumns,
  onGridReady,
  getContextMenuItems,
  linkIdColumn = null,
  linkedRow = null,
  onLinkedRowShown,
  pivotRowIds = null,
  findPivotRows = false,
  ...rest
}: ActionResultsGridProps) {
  const { runId, idColumn, rows, columns: runColumns, rowsById } = results;
  const labels = useInstanceStore((s) => s.instance?.labels) ?? NO_LABELS;
  const max = useInstanceStore((s) => s.instance?.limits.maxAnnotationIds) ?? DEFAULT_MAX_IDS;
  const notifyContext = useContext(NotifyContext);
  const analyst = useAnalyst();
  const own = useMemo(
    () => [
      ...annotationColumnDefs({
        analyst,
        saveComment: (id, text) =>
          void saveComment(id, text, {
            store: getAnnotationStore(),
            notify: (options) => notifyContext?.(options),
            pollSoon: pollAnnotationsSoon,
          }),
      }),
      labelColumnDef(labels),
    ],
    [labels, analyst, notifyContext],
  );
  const columnDefs = useMemo(
    () => buildActionColumnDefs(declaredColumns, runColumns, own),
    [declaredColumns, runColumns, own],
  );
  const numberColumns = useMemo(
    () =>
      (runColumns ?? declaredColumns ?? []).filter((c) => c.type === 'number').map((c) => c.name),
    [runColumns, declaredColumns],
  );
  const rounded = useMemo(() => roundedColumns(rows, numberColumns), [rows, numberColumns]);
  /** The `columns:` block of the grid's `state`, for the Action file panel and Copy column settings. */
  const actionFile = useCallback(
    (state: GridState) => actionFileColumns({ state, declared: declaredColumns, runColumns, own }),
    [declaredColumns, runColumns, own],
  );
  // The grid is given the rows it starts with as its row data, then each change by transaction, so
  // a page doesn't make it take every row again.
  const [given] = useState(rows);
  const api = useRef<GridApi<GridRowWithId> | null>(null);
  /** The grid's api once it is ready, for what renders from it. */
  const [readyApi, setReadyApi] = useState<GridApi<GridRowWithId> | null>(null);
  const gridReady = readyApi !== null;
  useEffect(() => {
    if (!readyApi) return;
    const apply = (change: ResultsChange, now: Results | null) => {
      if (!readyApi.isDestroyed() && now?.runId === runId) applyChange(readyApi, change, now);
    };
    // What changed before the grid was ready.
    const now = resultsOf(tabId);
    if (now && now.rows !== given) apply({ type: 'replaced' }, now);
    return subscribeResults(tabId, apply);
  }, [readyApi, tabId, runId, given]);
  const { start, keep, columnViews } = useActionColumnView(tabId);
  const context = useMemo(() => ({ columnViews, actionFile }), [columnViews, actionFile]);
  const ready = useCallback(
    (e: GridReadyEvent<GridRowWithId>) => {
      api.current = e.api;
      setReadyApi(e.api);
      void start(e.api);
      onGridReady?.(e);
    },
    [onGridReady, start],
  );
  const labelling = useMemo<LabelMenuOptions>(
    () => ({
      store: getAnnotationStore(),
      labels,
      max,
      notify: (options) => notifyContext?.(options),
      pollSoon: pollAnnotationsSoon,
    }),
    [labels, max, notifyContext],
  );
  const labelMenu = useMemo(() => buildLabelMenu(labelling), [labelling]);
  const sinks = useSinks(runColumns);
  const {
    menu: annotateMenu,
    keys: annotateKeys,
    dialog,
  } = useAnnotating({ labels, max, rowsById, sinks });
  const sinkMenu = useCallback<GetExtraContextMenuItems>(
    (params) => {
      const rows = targetRows(params.api as GridApi<GridRowWithId>, params.node);
      return buildSinkMenu({
        actions: sinks.sinks,
        rowCount: rows.length,
        max,
        onRun: (sink) => sinks.run(sink, rows),
      });
    },
    [sinks, max],
  );
  const {
    menu: rowDetailMenu,
    keys: rowDetailKeys,
    onCellFocused,
    panel: rowDetail,
    open: openRowDetail,
    follow: followRows,
  } = useRowDetail({ labels, columns: runColumns });
  useEffect(() => followRows(rows), [rows, followRows]);
  const linkedShown = useRef(false);
  useEffect(() => {
    const grid = api.current;
    if (linkedRow === null || linkedShown.current || !gridReady || !grid) return;
    const node = grid.getRowNode(String(linkedRow));
    if (!node?.data) return;
    linkedShown.current = true;
    for (let group = node.parent; group && group.level >= 0; group = group.parent) {
      group.setExpanded(true, undefined, true);
    }
    grid.ensureNodeVisible(node, 'middle');
    const column = grid.getAllDisplayedColumns().find((c) => !c.getColId().startsWith('ag-Grid-'));
    if (node.rowIndex !== null && column) grid.setFocusedCell(node.rowIndex, column);
    openRowDetail(node.data);
    onLinkedRowShown?.();
  }, [linkedRow, gridReady, rows, openRowDetail, onLinkedRowShown]);
  const linkMenu = useCallback<GetExtraContextMenuItems>(
    ({ node }) => {
      const row = (node?.data as GridRowWithId | undefined)?.row;
      return [
        {
          name: 'Copy link',
          disabled: typeof row !== 'number',
          action: () => {
            if (typeof row === 'number') {
              void copyShareLink(runId, row, notifyContext, linkIdColumn);
            }
          },
        },
      ];
    },
    [runId, linkIdColumn, notifyContext],
  );
  const idColumnMenu = useCallback<GetExtraContextMenuItems>(
    ({ column, node }) => {
      const name = column?.getColId();
      const data = node?.data as RunRow | undefined;
      if (!onIdColumnChange || !name || name === idColumn || !data || !(name in data.data))
        return [];
      return [{ name: `Use ${name} as Id column`, action: () => onIdColumnChange(name) }];
    },
    [idColumn, onIdColumnChange],
  );
  const copySettingsItem = useCallback(
    (api: GridApi) => copyColumnSettingsItem(() => actionFile(api.getState()), notifyContext),
    [actionFile, notifyContext],
  );
  const copyColumnSettingsMenu = useCallback<GetExtraContextMenuItems>(
    (params) => [copySettingsItem(params.api)],
    [copySettingsItem],
  );
  const menu = useMemo(
    () => [
      ((params) => [
        ...labelMenu(params),
        ...annotateMenu(params),
        ...rowDetailMenu(params),
      ]) satisfies GetExtraContextMenuItems,
      idColumnMenu,
      ...(getContextMenuItems ? [getContextMenuItems] : []),
      sinkMenu,
      copyColumnSettingsMenu,
      linkMenu,
    ],
    [
      labelMenu,
      annotateMenu,
      rowDetailMenu,
      idColumnMenu,
      getContextMenuItems,
      sinkMenu,
      copyColumnSettingsMenu,
      linkMenu,
    ],
  );
  const getMainMenuItems = useCallback<GetMainMenuItems<GridRowWithId>>(
    (params) => [...params.defaultItems, 'separator', copySettingsItem(params.api)],
    [copySettingsItem],
  );
  const labelKeys = useMemo(() => makeLabelKeys(labelling), [labelling]);
  const onCellKeyDown = useCallback(
    (e: CellKeyDownEvent<GridRowWithId> | FullWidthCellKeyDownEvent) => {
      if (!('column' in e)) return;
      labelKeys(e);
      annotateKeys(e);
      rowDetailKeys(e);
    },
    [labelKeys, annotateKeys, rowDetailKeys],
  );
  const rowClassRules = useMemo(() => labelClassRules(labels), [labels]);
  return (
    <Box sx={{ position: 'relative', overflow: 'hidden' }}>
      <RoundedColumnsContext value={rounded}>
        <ResultsGrid
          {...rest}
          sideBar={ACTION_SIDE_BAR}
          statusPanels={ACTION_STATUS_PANELS}
          context={context}
          onStateUpdated={keep}
          rows={given}
          columnDefs={columnDefs}
          getContextMenuItems={menu}
          getMainMenuItems={getMainMenuItems}
          rowClassRules={rowClassRules}
          selectionSymbol={LabelSymbol}
          onCellKeyDown={onCellKeyDown}
          onCellFocused={onCellFocused}
          onGridReady={ready}
        />
      </RoundedColumnsContext>
      {findPivotRows && pivotRowIds && <GoToPivotRow api={readyApi} pivotRowIds={pivotRowIds} />}
      {rowDetail}
      {dialog}
    </Box>
  );
}
