import { useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import { themeBalham } from 'ag-grid-community';
import type {
  CellKeyDownEvent,
  ColDef,
  CellFocusedEvent,
  FullWidthCellKeyDownEvent,
  GetMainMenuItems,
  GridApi,
  GridReadyEvent,
  RowClassRules,
  SideBarDef,
  StateUpdatedEvent,
  StatusPanelDef,
} from 'ag-grid-community';
import { useTabColumnState } from './useTabColumnState';
import { initAgGridFromConfig } from './agGridSetup';
import { buildColumnDefs } from './columns';
import type { GridRowWithId } from './columns';
import {
  buildSelectionColumnDef,
  makeGetContextMenuItems,
  STATUS_PANELS,
  staticGridOptions,
} from './gridOptions';
import type { ExtraMenuItems, GetExtraContextMenuItems } from './gridOptions';
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
  /** The rows, each with its row number `row`, the grid row id. */
  rows: readonly GridRowWithId[];
  /** Column definitions to use instead of those built from the rows. */
  columnDefs?: ColDef[];
  /**
   * Extra context menu items, placed above copy / export. An array is a list of groups: each
   * non-empty group after the first comes after a separator (pivots).
   */
  getContextMenuItems?: GetExtraContextMenuItems | GetExtraContextMenuItems[];
  /** The column menu's items, instead of AG Grid's own. */
  getMainMenuItems?: GetMainMenuItems<GridRowWithId>;
  /** Exposes the grid api (column state save/restore, transactions). */
  onGridReady?: (event: GridReadyEvent<GridRowWithId>) => void;
  /** Rendered right of the quick filter. */
  toolbarExtra?: ReactNode;
  /** CSS height of the grid. */
  height?: string | number;
  /**
   * Identifies the grid (the tab uuid) so its column state survives the tab being hidden or
   * re-created. Without it column state is not kept.
   */
  stateKey?: string;
  /** Row class rules. */
  rowClassRules?: RowClassRules<GridRowWithId>;
  /** The selection column's symbol, beside the checkbox. */
  selectionSymbol?: ComponentType<CustomCellRendererProps>;
  onCellKeyDown?: (event: CellKeyDownEvent<GridRowWithId> | FullWidthCellKeyDownEvent) => void;
  /** Called when a cell takes focus. */
  onCellFocused?: (event: CellFocusedEvent<GridRowWithId>) => void;
  /** The side bar, instead of Columns and Filters. */
  sideBar?: SideBarDef;
  /** Status bar panels before the counts. */
  statusPanels?: StatusPanelDef[];
  /** The grid's `context`, for custom panels. */
  context?: Record<string, unknown>;
  /** The grid's state changed while it's shown (not while its tab is hidden). */
  onStateUpdated?: (event: StateUpdatedEvent<GridRowWithId>) => void;
}

export function ResultsGrid({
  rows,
  columnDefs: givenColumnDefs,
  getContextMenuItems,
  getMainMenuItems,
  onGridReady,
  toolbarExtra,
  height = 'calc(100vh - 200px)',
  stateKey,
  rowClassRules,
  selectionSymbol,
  onCellKeyDown,
  onCellFocused,
  sideBar,
  statusPanels,
  context: extraContext,
  onStateUpdated,
}: ResultsGridProps) {
  const [quick, setQuick] = useState('');
  const apiRef = useRef<GridApi<GridRowWithId> | null>(null);
  const { containerRef, attach, save } = useTabColumnState(stateKey);

  const statusBar = useMemo(
    () =>
      statusPanels && {
        statusPanels: [...statusPanels, ...STATUS_PANELS],
      },
    [statusPanels],
  );

  const rowData = useMemo(() => [...rows], [rows]);
  const columnDefs = useMemo(
    () => givenColumnDefs ?? buildColumnDefs(rows),
    [givenColumnDefs, rows],
  );
  const extraMenuItems = useMemo<GetExtraContextMenuItems | undefined>(() => {
    const groups = Array.isArray(getContextMenuItems)
      ? getContextMenuItems
      : getContextMenuItems
        ? [getContextMenuItems]
        : [];
    if (groups.length === 0) return undefined;
    return (params) =>
      groups.reduce<ExtraMenuItems>((acc, g) => {
        const items = g(params);
        if (items.length === 0) return acc;
        return [...acc, ...(acc.length > 0 ? ['separator' as const] : []), ...items];
      }, []);
  }, [getContextMenuItems]);
  const selectionColumnDef = useMemo(
    () => buildSelectionColumnDef(selectionSymbol),
    [selectionSymbol],
  );
  const menu = useMemo(() => makeGetContextMenuItems(extraMenuItems), [extraMenuItems]);

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
        <Box sx={{ flex: 5 }}>{toolbarExtra}</Box>
      </Box>
      <div ref={containerRef} style={{ height }} data-testid="results-grid">
        <AgGridReact<GridRowWithId>
          {...staticGridOptions}
          theme={gridTheme}
          selectionColumnDef={selectionColumnDef}
          rowData={rowData}
          columnDefs={columnDefs}
          context={extraContext}
          quickFilterText={quick}
          getContextMenuItems={menu}
          getMainMenuItems={getMainMenuItems}
          onCellFocused={onCellFocused}
          onCellKeyDown={onCellKeyDown}
          rowClassRules={rowClassRules}
          sideBar={sideBar ?? staticGridOptions.sideBar}
          statusBar={statusBar ?? staticGridOptions.statusBar}
          onStateUpdated={(e) => {
            save();
            const el = containerRef.current;
            if (el && (el.offsetWidth > 0 || el.offsetHeight > 0)) onStateUpdated?.(e);
          }}
          onGridReady={(e) => {
            apiRef.current = e.api;
            attach(e.api);
            onGridReady?.(e);
          }}
        />
      </div>
    </Box>
  );
}
