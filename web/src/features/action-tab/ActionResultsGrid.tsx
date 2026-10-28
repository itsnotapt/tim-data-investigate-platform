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
import { useSearchParams } from 'react-router';
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
import { annotationColumnDefs, useAnnotating, useRowDetail } from '../annotate';
// PROTOTYPE (#171)
import {
  isPrototypeVariant,
  PROTOTYPE_VARIANTS,
  prototypeCommentsColumnDefs,
  VARIANT_NAMES,
} from '../annotate/prototype171/commentsCellPrototype';
import { PrototypeSwitcher } from '../annotate/prototype171/PrototypeSwitcher';
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
  type LabelMenuOptions,
  type RowsById,
} from '../labels';
import { copyShareLink } from '../share-links';
import { buildSinkMenu, useSinks } from '../sinks';
import { buildActionColumnDefs } from './actionColumns';
import { RoundedColumnsContext, roundedColumns } from './roundedColumns';

/** The param that names the column giving each row its id (Run KQL's Id column). */
const ID_PARAM = 'idColumn';
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
  /** The action the rows came from. */
  action: string;
  /** The rows to show. Rows that continue the ones shown are added to them, as each page loads. */
  rows: readonly RunRow[];
  /** The action's declared columns. */
  declaredColumns?: readonly CatalogueColumn[] | null;
  /** The columns of the run the rows came from. */
  runColumns?: readonly RunColumn[] | null;
  /** More context menu items, after Label ▸, Annotate…, Comment… and Row detail, before the sinks. */
  getContextMenuItems?: GetExtraContextMenuItems;
  /** The run the rows came from, for each row's Copy link. */
  runId?: string | null;
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
 * `id`: the label's fill, stripe and symbol, the comments column, the hidden Label, Tags and Comment
 * text columns, Label ▸, Annotate…, Comment…, Row detail and their keys, the Row detail side panel, the
 * sinks, which take the rows, Copy column settings, and Copy link to the right-clicked row.
 * The annotations come from the annotation store, never from `row_results`; a teammate's change
 * from the feed flashes the rows it changes.
 * The columns, sorting, grouping and filters follow the tab's column view: the Views panel of the
 * side bar, with the view's name in the status bar.
 * The row a share link named is focused, with Row detail open on it, once it has arrived.
 * A `number` column's header warns when it holds whole numbers beyond ±(2^53 − 1), which round.
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
  // PROTOTYPE (#171): ?variant=A|B|C swaps the comments column for a prototype one.
  const [search] = useSearchParams();
  const rawVariant = import.meta.env.DEV ? search.get('variant') : null;
  const variant = isPrototypeVariant(rawVariant) ? rawVariant : null;
  const own = useMemo(
    () => [
      ...(variant
        ? [...prototypeCommentsColumnDefs(variant), ...annotationColumnDefs().slice(1)]
        : annotationColumnDefs()),
      labelColumnDef(labels),
    ],
    [labels, variant],
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
      api.current.applyTransaction({ add: [...added] });
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
  const labelMenu = useMemo(() => buildLabelMenu(labelling), [labelling]);
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
    menu: rowDetailMenu,
    keys: rowDetailKeys,
    onCellFocused,
    panel: rowDetail,
    open: openRowDetail,
  } = useRowDetail({ labels, idParam, columns: runColumns });
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
      ((params) => [
        ...labelMenu(params),
        ...annotateMenu(params),
        ...rowDetailMenu(params),
      ]) satisfies GetExtraContextMenuItems,
      ...(getContextMenuItems ? [getContextMenuItems] : []),
      sinkMenu,
      copyColumnSettingsMenu,
      linkMenu,
    ],
    [
      labelMenu,
      annotateMenu,
      rowDetailMenu,
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
      {variant && <PrototypeSwitcher variants={PROTOTYPE_VARIANTS} names={VARIANT_NAMES} />}
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
