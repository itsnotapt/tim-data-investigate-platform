import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import { themeBalham } from 'ag-grid-community';
import type {
  CellEditRequestEvent,
  CellKeyDownEvent,
  ColDef,
  CellFocusedEvent,
  FullWidthCellKeyDownEvent,
  GridApi,
  GridReadyEvent,
  RowClassRules,
} from 'ag-grid-community';
import { ColumnViewBar } from '../column-views';
import { DetailPanel } from './DetailPanel';
import { useTabColumnState } from './useTabColumnState';
import { initAgGridFromConfig } from './agGridSetup';
import { buildColumnDefs, prepareRows } from './columns';
import type { GridRow, GridRowWithId, TemplateColumns } from './columns';
import { useDeterminationSymbols } from './determinationSymbols';
import {
  buildSelectionColumnDef,
  buildSymbolSelectionColumnDef,
  determinationSymbolsMenuItem,
  makeGetContextMenuItems,
  staticGridOptions,
} from './gridOptions';
import type { ExtraMenuItems, GetExtraContextMenuItems } from './gridOptions';
import { createStatsStore } from './status';
import type { ExecutionStats, StatsStore } from './status';
import './grid.css';

// Registers modules and applies the licence key before any grid renders (this chunk is lazy).
initAgGridFromConfig();

/**
 * Balham with the theme palette's CSS variables (`web/src/app/theme.ts`), the same params in both
 * colour schemes.
 */
const gridTheme = themeBalham.withParams({
  backgroundColor: 'var(--mui-palette-background-paper)',
  foregroundColor: 'var(--mui-palette-text-primary)',
  textColor: 'var(--mui-palette-text-primary)',
  borderColor: 'var(--mui-palette-divider)',
  accentColor: 'var(--mui-palette-primary-main)',
  headerBackgroundColor: 'var(--mui-palette-grid-header)',
  chromeBackgroundColor: 'var(--mui-palette-grid-header)',
  oddRowBackgroundColor: 'var(--mui-palette-grid-oddRow)',
  statusBarLabelColor: 'var(--mui-palette-text-secondary)',
});

export interface ResultsGridProps {
  rows: readonly GridRow[];
  /** Template `columns` (ColDef overrides by column name, plus `default`). */
  templateColumns?: TemplateColumns;
  /** Template `columnId`: row-id column (default `EventId`). */
  columnId?: string | null;
  /** Column definitions to use instead of those built from the rows and `templateColumns`. */
  columnDefs?: ColDef[];
  stats?: ExecutionStats;
  /**
   * Extra context menu items, placed above copy / export. An array is a list of groups: the first
   * group is followed by "Show details" (tagging), each later non-empty group comes after a
   * separator (pivots).
   */
  getContextMenuItems?: GetExtraContextMenuItems | GetExtraContextMenuItems[];
  /** Exposes the grid api (column state save/restore, transactions). */
  onGridReady?: (event: GridReadyEvent<GridRowWithId>) => void;
  onCellEditRequest?: (event: CellEditRequestEvent<GridRowWithId>) => void;
  /** Rendered right of the quick filter (column view bar). */
  toolbarExtra?: ReactNode;
  /** CSS height of the grid. */
  height?: string | number;
  /** Column view bar beside the quick filter. Default on. */
  columnViews?: boolean;
  /** Detail drawer, "Show details" context menu item, follows the focused cell. Default on. */
  detailPanel?: boolean;
  /**
   * Identifies the grid (the tab uuid) so its column state survives the tab being hidden or
   * re-created. Without it column state is not kept.
   */
  stateKey?: string;
  /** Extra row class rules, beside the determination ones. */
  rowClassRules?: RowClassRules<GridRowWithId>;
  /**
   * The selection column's symbol, always shown, instead of the determination symbol the analyst
   * can show or hide.
   */
  selectionSymbol?: ComponentType<CustomCellRendererProps>;
  onCellKeyDown?: (event: CellKeyDownEvent<GridRowWithId> | FullWidthCellKeyDownEvent) => void;
  /** Called when a cell takes focus, after the detail panel follows it. */
  onCellFocused?: (event: CellFocusedEvent<GridRowWithId>) => void;
}

export function ResultsGrid({
  rows,
  templateColumns,
  columnId,
  columnDefs: givenColumnDefs,
  stats,
  getContextMenuItems,
  onGridReady,
  onCellEditRequest,
  toolbarExtra,
  height = 'calc(100vh - 200px)',
  columnViews = true,
  detailPanel = true,
  stateKey,
  rowClassRules,
  selectionSymbol,
  onCellKeyDown,
  onCellFocused: givenOnCellFocused,
}: ResultsGridProps) {
  const [quick, setQuick] = useState('');
  const apiRef = useRef<GridApi<GridRowWithId> | null>(null);
  const [gridApi, setGridApi] = useState<GridApi<GridRowWithId> | null>(null);
  const { containerRef, attach, save } = useTabColumnState(stateKey);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<GridRowWithId | null>(null);
  const detailOpenRef = useRef(false);
  useEffect(() => {
    detailOpenRef.current = detailOpen;
  }, [detailOpen]);

  const [statsStore] = useState<StatsStore>(() => createStatsStore());
  statsStore.set(stats ?? {});
  const context = useMemo(() => ({ statsStore }), [statsStore]);

  const rowData = useMemo(() => prepareRows(rows, columnId), [rows, columnId]);
  const columnDefs = useMemo(
    () => givenColumnDefs ?? buildColumnDefs(rows, templateColumns),
    [givenColumnDefs, rows, templateColumns],
  );
  const extraMenuItems = useMemo<GetExtraContextMenuItems | undefined>(() => {
    const groups = Array.isArray(getContextMenuItems)
      ? getContextMenuItems
      : getContextMenuItems
        ? [getContextMenuItems]
        : [];
    if (!detailPanel && groups.length === 0) return undefined;
    return (params) => {
      const [first, ...rest] = groups;
      const head: ExtraMenuItems = [
        ...(first?.(params) ?? []),
        ...(detailPanel
          ? [
              {
                name: 'Show details',
                disabled: !params.node?.data,
                action: () => {
                  setDetailRow((params.node?.data as GridRowWithId | undefined) ?? null);
                  setDetailOpen(true);
                },
              },
            ]
          : []),
      ];
      return rest.reduce<ExtraMenuItems>((acc, g) => {
        const items = g(params);
        if (items.length === 0) return acc;
        return [...acc, ...(acc.length > 0 ? ['separator' as const] : []), ...items];
      }, head);
    };
  }, [detailPanel, getContextMenuItems]);
  const showSymbols = useDeterminationSymbols((s) => s.show);
  const setShowSymbols = useDeterminationSymbols((s) => s.setShow);
  const selectionColumnDef = useMemo(
    () =>
      selectionSymbol
        ? buildSymbolSelectionColumnDef(selectionSymbol)
        : buildSelectionColumnDef(showSymbols, setShowSymbols),
    [selectionSymbol, showSymbols, setShowSymbols],
  );
  const menu = useMemo(
    () =>
      makeGetContextMenuItems(
        extraMenuItems,
        selectionSymbol ? [] : [determinationSymbolsMenuItem(showSymbols, setShowSymbols)],
      ),
    [extraMenuItems, selectionSymbol, showSymbols, setShowSymbols],
  );

  const classRules = useMemo(
    () => ({ ...staticGridOptions.rowClassRules, ...rowClassRules }),
    [rowClassRules],
  );

  // The open panel follows the focused cell's row.
  const onCellFocused = useCallback(
    (e: CellFocusedEvent<GridRowWithId>) => {
      if (detailOpenRef.current && e.rowIndex !== null) {
        const node = e.api.getDisplayedRowAtIndex(e.rowIndex);
        if (node?.data) setDetailRow(node.data);
      }
      givenOnCellFocused?.(e);
    },
    [givenOnCellFocused],
  );

  return (
    <Box sx={{ position: 'relative', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', pt: 1.25, pb: 0.5 }}>
        <TextField
          size="small"
          label="Quick UI filter"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          sx={{ flex: 7 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Box sx={{ flex: 5 }}>
          {columnViews && <ColumnViewBar api={gridApi} />}
          {toolbarExtra}
        </Box>
      </Box>
      <div ref={containerRef} style={{ height }} data-testid="results-grid">
        <AgGridReact<GridRowWithId>
          {...staticGridOptions}
          theme={gridTheme}
          selectionColumnDef={selectionColumnDef}
          rowData={rowData}
          columnDefs={columnDefs}
          context={context}
          quickFilterText={quick}
          getContextMenuItems={menu}
          onCellEditRequest={onCellEditRequest}
          onCellFocused={onCellFocused}
          onCellKeyDown={onCellKeyDown}
          rowClassRules={classRules}
          onStateUpdated={save}
          onGridReady={(e) => {
            apiRef.current = e.api;
            setGridApi(e.api);
            attach(e.api);
            onGridReady?.(e);
          }}
        />
      </div>
      {detailPanel && (
        <DetailPanel open={detailOpen} data={detailRow} onClose={() => setDetailOpen(false)} />
      )}
    </Box>
  );
}
