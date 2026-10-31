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
import { useAnalyst } from '../analyst';
import { annotationColumnDefs, saveComment, useAnnotating, useRowDetail } from '../annotate';
import type { GridRowWithId } from '../grid/columns';
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
  withIds,
  type LabelMenuOptions,
  type RowsById,
} from '../labels';
import { copyShareLink } from '../share-links';
import { buildSinkMenu, useSinks } from '../sinks';
import { buildActionColumnDefs } from './actionColumns';
import { RoundedColumnsContext, roundedColumns } from './roundedColumns';

const NO_LABELS: readonly InstanceLabel[] = [];
/** `maxAnnotationIds` until the instance says otherwise. */
const DEFAULT_MAX_IDS = 10_000;

export type ActionResultsGridProps = Omit<
  ResultsGridProps,
  | 'rows'
  | 'columnDefs'
  | 'stateKey'
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
  /** The rows to show. Rows that continue the ones shown are added to them, as each page loads. */
  rows: readonly RunRow[];
  /** The Id column: the column whose value is each row's `id`. `null`: the rows have no id. */
  idColumn?: string | null;
  /** Called with the column a cell's Use … as Id column picks. */
  onIdColumnChange?: (column: string) => void;
  /** The action's declared columns. */
  declaredColumns?: readonly CatalogueColumn[] | null;
  /** The columns of the run the rows came from. */
  runColumns?: readonly RunColumn[] | null;
  /** More context menu items, after Label ▸, Annotate…, Comment… and Row detail, before the sinks. */
  getContextMenuItems?: GetExtraContextMenuItems;
  /** The run the rows came from, for each row's Copy link. */
  runId?: string | null;
  /** The Id column Copy link carries: `idColumn` when it isn't the one the run opens with. */
  linkIdColumn?: string | null;
  /** The row a share link named: focused, with Row detail open on it, once it has arrived. */
  linkedRow?: number | null;
  /** Called once the linked row is focused. */
  onLinkedRowShown?: () => void;
};

/** Whether `next` is `shown` with more rows after it (pages append; a reload gives new objects). */
const continues = (shown: readonly RunRow[], next: readonly RunRow[]) =>
  shown.length > 0 && next.length > shown.length && next[shown.length - 1] === shown.at(-1);

/**
 * An action tab's rows, keyed by `row`, with the action's columns and the annotations of each row's
 * `id`, the value of its Id column. A cell's Use … as Id column asks for its column to be the Id
 * column; when `idColumn` changes, the rows take the annotations of their new ids in place, keeping
 * the selection, filters, sort and scroll. The annotations show the label's fill, stripe and
 * symbol, the comments column, the hidden Label, Tags and Comment text columns, Label ▸, Annotate…,
 * Comment…, Row detail and their keys, the Row detail side panel, the sinks, which take the rows,
 * Copy column settings, and Copy link to the right-clicked row.
 * The annotations come from the annotation store, never from `row_results`; a teammate's change
 * from the feed flashes the rows it changes.
 * The columns, sorting, grouping and filters follow the tab's column view: the Views panel of the
 * side bar, with the view's name in the status bar.
 * The row a share link named is focused, with Row detail open on it, once it has arrived.
 * A `number` column's header warns when it holds whole numbers beyond ±(2^53 − 1), which round.
 */
export function ActionResultsGrid({
  uuid,
  rows,
  idColumn = null,
  onIdColumnChange,
  declaredColumns,
  runColumns,
  onGridReady,
  getContextMenuItems,
  runId = null,
  linkIdColumn = null,
  linkedRow = null,
  onLinkedRowShown,
  ...rest
}: ActionResultsGridProps) {
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
  // The grid is given `given`, the rows with their ids, as its row data; rows that continue them go
  // in by transaction, so a page doesn't make the grid take every row again. Another Id column
  // gives the grid every row again, with the same row ids, so it updates them in place.
  const [given, setGiven] = useState(() => withIds(rows, idColumn));
  const shown = useRef({ rows, idColumn });
  const api = useRef<GridApi<GridRowWithId> | null>(null);
  const [gridReady, setGridReady] = useState(false);
  const [index] = useState<RowsById>(() => {
    const byId: RowsById = new Map();
    indexRows(byId, given);
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
    const was = shown.current;
    if (rows === was.rows && idColumn === was.idColumn) return;
    if (api.current && idColumn === was.idColumn && continues(was.rows, rows)) {
      const added = withIds(rows.slice(was.rows.length), idColumn);
      api.current.applyTransaction({ add: added });
      indexRows(index, added);
      void showStoredAnnotations(added.flatMap((r) => (r.id ? [r.id] : [])));
    } else {
      const all = withIds(rows, idColumn);
      index.clear();
      indexRows(index, all);
      setGiven(all);
    }
    shown.current = { rows, idColumn };
  }, [rows, idColumn, index, showStoredAnnotations]);
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
  } = useAnnotating({ labels, max, rowsById: index, sinks });
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
  useEffect(() => followRows(given), [given, followRows]);
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
  }, [linkedRow, gridReady, given, rows, openRowDetail, onLinkedRowShown]);
  const linkMenu = useCallback<GetExtraContextMenuItems>(
    ({ node }) => {
      if (runId === null) return [];
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
      {rowDetail}
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
