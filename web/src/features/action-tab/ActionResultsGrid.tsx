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
import type { CatalogueColumn, InstanceLabel, RunColumn, RunRow } from '../../lib/api';
import {
  ACTION_SIDE_BAR,
  ACTION_STATUS_PANELS,
  actionFileColumns,
  copyColumnSettingsItem,
  useActionColumnView,
} from '../action-column-views';
import { annotationColumnDefs, useAnnotating, useHistoryPanel } from '../annotate';
import { prepareRows, type GridRowWithId } from '../grid/columns';
import type { GetExtraContextMenuItems } from '../grid/gridOptions';
import { ResultsGrid, type ResultsGridProps } from '../grid/ResultsGrid';
import { useRowResults } from '../grid/useRowResults';
import { useInstanceStore } from '../instance';
import {
  buildLabelMenu,
  indexRows,
  labelClassRules,
  labelColumnDef,
  LabelSymbol,
  makeLabelKeys,
  targetRows,
  updateRowAnnotations,
  type LabelMenuOptions,
  type RowsById,
} from '../labels';
import { copyShareLink } from '../share-links';
import { buildSinkMenu, useSinks } from '../sinks';
import { buildActionColumnDefs } from './actionColumns';

/** The grid row id: the run's row ordinal. */
const ROW_ID = 'row';

/** The param that names the column giving each row its id (Run KQL's Id column). */
const ID_PARAM = 'idColumn';
const NO_LABELS: readonly InstanceLabel[] = [];
/** `maxAnnotationIds` until the instance says otherwise. */
const DEFAULT_MAX_IDS = 10_000;

export type ActionResultsGridProps = Omit<
  ResultsGridProps,
  | 'rows'
  | 'columnId'
  | 'columnDefs'
  | 'stateKey'
  | 'columnViews'
  | 'sideBar'
  | 'statusPanels'
  | 'context'
  | 'onStateUpdated'
  | 'rowClassRules'
  | 'selectionSymbol'
  | 'onCellKeyDown'
  | 'onCellFocused'
> & {
  uuid: string;
  /** The action the rows came from. */
  action: string;
  /** The rows to show. Rows that continue the ones shown are added to them, as each page loads. */
  rows: readonly RunRow[];
  /** The action's declared columns. */
  declaredColumns?: readonly CatalogueColumn[] | null;
  /** The columns of the run the rows came from. */
  runColumns?: readonly RunColumn[] | null;
  /** More context menu items, after Label ▸, Show details, Annotate…, Comment… and History, before the sinks. */
  getContextMenuItems?: GetExtraContextMenuItems;
  /** The run the rows came from, for each row's Copy link. */
  runId?: string | null;
  /** The row a share link named: focused, with its History open, once it has arrived. */
  linkedRow?: number | null;
  /** Called once the linked row is focused. */
  onLinkedRowShown?: () => void;
};

/** Whether `next` is `shown` with more rows after it (pages append; a reload gives new objects). */
const continues = (shown: readonly RunRow[], next: readonly RunRow[]) =>
  shown.length > 0 && next.length > shown.length && next[shown.length - 1] === shown.at(-1);

/**
 * An action tab's rows, keyed by `row`, with the action's columns and the annotations of each row's
 * `id`: the label's fill, stripe and symbol, the comments column, the hidden Label, Tags and Comment
 * text columns, Label ▸, Annotate…, Comment…, History and their keys, the History panel, the
 * sinks, which take the rows, Copy column settings, and Copy link to the right-clicked row.
 * The annotations come from the annotation store, never from `row_results`; a teammate's change
 * from the feed flashes the rows it changes.
 * The columns, sorting, grouping and filters follow the tab's column view: the Views panel of the
 * side bar, with the view's name in the status bar.
 * The row a share link named is focused, with its History open, once it has arrived.
 */
export function ActionResultsGrid({
  uuid,
  action,
  rows,
  declaredColumns,
  runColumns,
  onGridReady,
  getContextMenuItems,
  runId = null,
  linkedRow = null,
  onLinkedRowShown,
  ...rest
}: ActionResultsGridProps) {
  const labels = useInstanceStore((s) => s.instance?.labels) ?? NO_LABELS;
  const max = useInstanceStore((s) => s.instance?.limits.maxAnnotationIds) ?? DEFAULT_MAX_IDS;
  const idParam = useInstanceStore(
    (s) =>
      s.instance?.actions.find((a) => a.key === action)?.params.some((p) => p.name === ID_PARAM) ??
      false,
  );
  const notifyContext = useContext(NotifyContext);
  const own = useMemo(() => [...annotationColumnDefs(), labelColumnDef(labels)], [labels]);
  const columnDefs = useMemo(
    () => buildActionColumnDefs(declaredColumns, runColumns, own),
    [declaredColumns, runColumns, own],
  );
  /** The `columns:` block of the grid's `state`, for the Action file panel and Copy column settings. */
  const actionFile = useCallback(
    (state: GridState) => actionFileColumns({ state, declared: declaredColumns, runColumns, own }),
    [declaredColumns, runColumns, own],
  );
  // The grid is given `given` as its row data; rows that continue them go in by transaction, so a
  // page doesn't make the grid take every row again.
  const [given, setGiven] = useState(rows);
  const shown = useRef(rows);
  const api = useRef<GridApi<GridRowWithId> | null>(null);
  const [gridReady, setGridReady] = useState(false);
  const [index] = useState<RowsById>(() => {
    const byId: RowsById = new Map();
    indexRows(byId, rows);
    return byId;
  });
  /** Gives the rows of `ids` (else every `id`) the annotations the store has. */
  const showStoredAnnotations = useCallback(
    async (ids: readonly string[] = [...index.keys()]) => {
      const found = await getAnnotationStore().get(ids);
      const grid = api.current;
      if (grid && !grid.isDestroyed()) updateRowAnnotations(grid, index, [...found.values()]);
    },
    [index],
  );
  useEffect(() => {
    if (rows === shown.current) return;
    if (api.current && continues(shown.current, rows)) {
      const added = rows.slice(shown.current.length);
      api.current.applyTransaction({ add: prepareRows(added, ROW_ID) });
      indexRows(index, added);
      void showStoredAnnotations(added.flatMap((r) => (r.id ? [r.id] : [])));
    } else {
      index.clear();
      indexRows(index, rows);
      setGiven(rows);
    }
    shown.current = rows;
  }, [rows, index, showStoredAnnotations]);
  // After the grid takes new row data.
  useEffect(() => {
    void showStoredAnnotations();
  }, [given, showStoredAnnotations]);
  useEffect(
    () =>
      getAnnotationStore().subscribe(({ changes, source }) => {
        const grid = api.current;
        if (!grid || grid.isDestroyed()) return;
        const changed = updateRowAnnotations(grid, index, changes);
        if (source === 'feed' && changed.length > 0) grid.flashCells({ rowNodes: changed });
      }),
    [index],
  );
  const { start, keep, columnViews } = useActionColumnView(uuid);
  const context = useMemo(() => ({ columnViews, actionFile }), [columnViews, actionFile]);
  const ready = useCallback(
    (e: GridReadyEvent<GridRowWithId>) => {
      api.current = e.api;
      setGridReady(true);
      void start(e.api);
      void showStoredAnnotations();
      onGridReady?.(e);
    },
    [onGridReady, showStoredAnnotations, start],
  );
  const labelling = useMemo<LabelMenuOptions>(
    () => ({
      store: getAnnotationStore(),
      labels,
      max,
      idParam,
      notify: (options) => notifyContext?.(options),
      pollSoon: pollAnnotationsSoon,
    }),
    [labels, max, idParam, notifyContext],
  );
  const sinks = useSinks(runColumns);
  const {
    menu: annotateMenu,
    keys: annotateKeys,
    dialog,
  } = useAnnotating({ labels, max, idParam, rowsById: index, sinks });
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
    menu: historyMenu,
    keys: historyKeys,
    onCellFocused,
    panel: historyPanel,
    open: openHistory,
  } = useHistoryPanel({ labels, idParam });
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
    openHistory(node.data);
    onLinkedRowShown?.();
  }, [linkedRow, gridReady, given, rows, openHistory, onLinkedRowShown]);
  const linkMenu = useCallback<GetExtraContextMenuItems>(
    ({ node }) => {
      if (runId === null) return [];
      const row = (node?.data as GridRowWithId | undefined)?.row;
      return [
        {
          name: 'Copy link',
          disabled: typeof row !== 'number',
          action: () => {
            if (typeof row === 'number') void copyShareLink(runId, row, notifyContext);
          },
        },
      ];
    },
    [runId, notifyContext],
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
      buildLabelMenu(labelling),
      ((params) => [
        ...annotateMenu(params),
        ...historyMenu(params),
      ]) satisfies GetExtraContextMenuItems,
      ...(getContextMenuItems ? [getContextMenuItems] : []),
      sinkMenu,
      copyColumnSettingsMenu,
      linkMenu,
    ],
    [
      labelling,
      annotateMenu,
      historyMenu,
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
      historyKeys(e);
    },
    [labelKeys, annotateKeys, historyKeys],
  );
  const rowClassRules = useMemo(() => labelClassRules(labels), [labels]);
  return (
    <Box sx={{ position: 'relative', overflow: 'hidden' }}>
      <ResultsGrid
        {...rest}
        columnViews={false}
        sideBar={ACTION_SIDE_BAR}
        statusPanels={ACTION_STATUS_PANELS}
        context={context}
        onStateUpdated={keep}
        rows={given}
        columnId={ROW_ID}
        columnDefs={columnDefs}
        getContextMenuItems={menu}
        getMainMenuItems={getMainMenuItems}
        rowClassRules={rowClassRules}
        selectionSymbol={LabelSymbol}
        onCellKeyDown={onCellKeyDown}
        onCellFocused={onCellFocused}
        onGridReady={ready}
      />
      {historyPanel}
      {dialog}
    </Box>
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
