import Box from '@mui/material/Box';
import type {
  CellFocusedEvent,
  CellKeyDownEvent,
  FullWidthCellKeyDownEvent,
  GetContextMenuItemsParams,
  GetMainMenuItems,
  GridReadyEvent,
  GridState,
  StatusPanelDef,
} from 'ag-grid-community';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NotifyContext } from '../../components/notifyContext';
import { getAnnotationStore, pollAnnotationsSoon } from '../../lib/annotations';
import type { CatalogueColumn, InstanceLabel } from '../../lib/api';
import {
  ACTION_SIDE_BAR,
  ACTION_STATUS_PANELS,
  actionFileColumns,
  copyColumnSettingsItem,
  useActionColumnView,
} from '../action-column-views';
import { useAnalyst } from '../analyst';
import { annotationColumnDefs, saveComment, useAnnotating, useRowDetail } from '../annotate';
import type { RowsMenu, RowTargets } from '../grid';
import type { GridRowWithId } from '../grid/columns';
import type { GetExtraContextMenuItems } from '../grid/gridOptions';
import { ResultsGrid, type ResultsGridProps } from '../grid/ResultsGrid';
import { useInstanceStore } from '../instance';
import {
  buildLabelMenu,
  labelClassRules,
  labelColumnDef,
  LabelSymbol,
  makeLabelKeys,
  type LabelMenuOptions,
  type RowsOf,
} from '../labels';
import { copyShareLink } from '../share-links';
import { buildSinkMenu, useSinks } from '../sinks';
import { buildActionColumnDefs } from './actionColumns';
import { gridView, type GridView } from './gridView';
import {
  pivotRowClassRules,
  usePivotRowHighlight,
  usePivotRows,
  useShowPivotRows,
} from './pivotRows';
import { PivotRowsStatusPanel } from './PivotRowsStatusPanel';
import {
  resultRows,
  resultsOf,
  subscribeResults,
  type Results,
  type ResultsChange,
} from './results';

const NO_LABELS: readonly InstanceLabel[] = [];
const NO_IDS: ReadonlySet<string> = new Set();
/** `maxAnnotationIds` until the instance says otherwise. */
const DEFAULT_MAX_IDS = 10_000;
/** The column view on the left, the pivot row controls in the centre. */
const STATUS_PANELS: StatusPanelDef[] = [
  ...ACTION_STATUS_PANELS,
  { statusPanel: PivotRowsStatusPanel, align: 'center' },
];

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
  | 'getContextMenuItems'
> & {
  tabId: string;
  /** The tab's Results, as they are now: the grid applies each change to them as it comes. */
  results: Results;
  /** Called with the column a cell's Use … as Id column picks. */
  onIdColumnChange?: (column: string) => void;
  /** The action's declared columns. */
  declaredColumns?: readonly CatalogueColumn[] | null;
  /** More context menu items, after Label ▸, Annotate…, Comment… and Row detail, before the sinks. */
  getContextMenuItems?: RowsMenu;
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
 * A tab pivoted into an action that finds pivot rows shows Go to pivot row in the status bar.
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
  /** The `columns:` block of the grid's `state`, for the Action file panel and Copy column settings. */
  const actionFile = useCallback(
    (state: GridState) => actionFileColumns({ state, declared: declaredColumns, runColumns, own }),
    [declaredColumns, runColumns, own],
  );
  // The grid is given the rows it starts with (`given`, flattened to `startRows`) as its row data,
  // then each change by transaction, so a page doesn't make it take every row again.
  const [given] = useState(rows);
  const [startRows] = useState(() => given.flat());
  /** The grid once it is ready. */
  const [view, setView] = useState<GridView | null>(null);
  useEffect(() => {
    if (!view) return;
    const apply = (change: ResultsChange, now: Results | null) => {
      if (!view.isDestroyed() && now?.runId === runId) view.apply(change, now);
    };
    // What changed before the grid was ready.
    const now = resultsOf(tabId);
    if (now && now.rows !== given) apply({ type: 'replaced' }, now);
    return subscribeResults(tabId, apply);
  }, [view, tabId, runId, given]);
  /** The rows of the tab's Results with these row numbers, as they are when it's called. */
  const rowsOf = useCallback<RowsOf>((rowNumbers) => resultRows(tabId, rowNumbers), [tabId]);
  const { start, keep, columnViews } = useActionColumnView(tabId);
  useShowPivotRows(tabId, findPivotRows ? pivotRowIds : null);
  const context = useMemo(
    () => ({ tabId, columnViews, actionFile }),
    [tabId, columnViews, actionFile],
  );
  const ready = useCallback(
    (e: GridReadyEvent<GridRowWithId>) => {
      setView(gridView(e.api));
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
      rowsOf,
      notify: (options) => notifyContext?.(options),
      pollSoon: pollAnnotationsSoon,
    }),
    [labels, max, rowsOf, notifyContext],
  );
  const labelMenu = useMemo(() => buildLabelMenu(labelling), [labelling]);
  const sinks = useSinks(runColumns);
  const {
    menu: annotateMenu,
    keys: annotateKeys,
    dialog,
  } = useAnnotating({ labels, max, rowsById, rowsOf, sinks });
  const sinkMenu = useCallback<RowsMenu>(
    (targets) =>
      buildSinkMenu({
        actions: sinks.sinks,
        rowCount: rowsOf(targets.rows).length,
        max,
        onRun: (sink) => sinks.run(sink, rowsOf(targets.rows)),
      }),
    [sinks, max, rowsOf],
  );
  const {
    menu: rowDetailMenu,
    keys: rowDetailKeys,
    onRowFocused,
    panel: rowDetail,
    open: openRowDetail,
  } = useRowDetail({ labels, columns: runColumns, rowsOf });
  const linkedShown = useRef(false);
  useEffect(() => {
    if (linkedRow === null || linkedShown.current || !view) return;
    if (rowsOf([linkedRow]).length === 0 || !view.goTo(linkedRow)) return;
    linkedShown.current = true;
    openRowDetail(linkedRow);
    onLinkedRowShown?.();
  }, [linkedRow, view, rows, rowsOf, openRowDetail, onLinkedRowShown]);
  const linkMenu = useCallback<RowsMenu>(
    ({ row }) => [
      {
        name: 'Copy link',
        disabled: row === null,
        action: () => {
          if (row !== null) void copyShareLink(runId, row, notifyContext, linkIdColumn);
        },
      },
    ],
    [runId, linkIdColumn, notifyContext],
  );
  const idColumnMenu = useCallback<RowsMenu>(
    ({ row, column }) => {
      const [clicked] = rowsOf(row === null ? [] : [row]);
      if (
        !onIdColumnChange ||
        !column ||
        column === idColumn ||
        !clicked ||
        !(column in clicked.data)
      )
        return [];
      return [{ name: `Use ${column} as Id column`, action: () => onIdColumnChange(column) }];
    },
    [idColumn, onIdColumnChange, rowsOf],
  );
  const copySettingsItem = useCallback(
    (state: () => GridState) => copyColumnSettingsItem(() => actionFile(state()), notifyContext),
    [actionFile, notifyContext],
  );
  const copyColumnSettingsMenu = useCallback<RowsMenu>(
    () => (view ? [copySettingsItem(() => view.state())] : []),
    [copySettingsItem, view],
  );
  const menu = useMemo(() => {
    // The targets of each menu opened, worked out once for all its items.
    const targets = new WeakMap<GetContextMenuItemsParams, RowTargets>();
    const targetsOf = (params: GetContextMenuItemsParams) => {
      let found = targets.get(params);
      if (!found) {
        found = gridView(params.api).targets(params.node, params.column);
        targets.set(params, found);
      }
      return found;
    };
    const groups: RowsMenu[] = [
      (t) => [...labelMenu(t), ...annotateMenu(t), ...rowDetailMenu(t)],
      idColumnMenu,
      ...(getContextMenuItems ? [getContextMenuItems] : []),
      sinkMenu,
      copyColumnSettingsMenu,
      linkMenu,
    ];
    return groups.map(
      (group): GetExtraContextMenuItems =>
        (params) =>
          group(targetsOf(params)),
    );
  }, [
    labelMenu,
    annotateMenu,
    rowDetailMenu,
    idColumnMenu,
    getContextMenuItems,
    sinkMenu,
    copyColumnSettingsMenu,
    linkMenu,
  ]);
  const getMainMenuItems = useCallback<GetMainMenuItems<GridRowWithId>>(
    (params) => [
      ...params.defaultItems,
      'separator',
      copySettingsItem(() => gridView(params.api).state()),
    ],
    [copySettingsItem],
  );
  const labelKeys = useMemo(() => makeLabelKeys(labelling), [labelling]);
  const onCellKeyDown = useCallback(
    (e: CellKeyDownEvent<GridRowWithId> | FullWidthCellKeyDownEvent) => {
      const key = e.event as KeyboardEvent | null | undefined;
      if (!('column' in e) || !key) return;
      const grid = gridView(e.api);
      if (grid.isEditing()) return;
      const targets = grid.targets(e.node, e.column);
      labelKeys(key, targets);
      annotateKeys(key, targets);
      rowDetailKeys(key, targets);
    },
    [labelKeys, annotateKeys, rowDetailKeys],
  );
  const onCellFocused = useCallback(
    (e: CellFocusedEvent<GridRowWithId>) => {
      const row = e.rowIndex === null ? null : gridView(e.api).displayedRow(e.rowIndex);
      if (row !== null) onRowFocused(row);
    },
    [onRowFocused],
  );
  const [highlight] = usePivotRowHighlight(tabId);
  const pivotRows = usePivotRows(tabId);
  const rowClassRules = useMemo(
    () => ({
      ...labelClassRules(labels),
      ...pivotRowClassRules(pivotRows?.ids ?? NO_IDS, highlight),
    }),
    [labels, pivotRows, highlight],
  );
  return (
    <Box sx={{ position: 'relative', overflow: 'hidden' }}>
      <ResultsGrid
        {...rest}
        sideBar={ACTION_SIDE_BAR}
        statusPanels={STATUS_PANELS}
        context={context}
        onStateUpdated={keep}
        rows={startRows}
        columnDefs={columnDefs}
        getContextMenuItems={menu}
        getMainMenuItems={getMainMenuItems}
        rowClassRules={rowClassRules}
        selectionSymbol={LabelSymbol}
        onCellKeyDown={onCellKeyDown}
        onCellFocused={onCellFocused}
        onGridReady={ready}
      />
      {rowDetail}
      {dialog}
    </Box>
  );
}
