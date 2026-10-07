import {
  CellApiModule,
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  ColumnApiModule,
  ColumnAutoSizeModule,
  CsvExportModule,
  CustomFilterModule,
  DateFilterModule,
  EventApiModule,
  GridStateModule,
  LargeTextEditorModule,
  ModuleRegistry,
  NumberFilterModule,
  QuickFilterModule,
  RenderApiModule,
  RowApiModule,
  RowAutoHeightModule,
  RowSelectionModule,
  RowStyleModule,
  ScrollApiModule,
  TextEditorModule,
  TextFilterModule,
  TooltipModule,
  ValidationModule,
} from 'ag-grid-community';
import type { Module } from 'ag-grid-community';
import {
  AggregationModule,
  CellSelectionModule,
  ClipboardModule,
  ColumnMenuModule,
  ColumnsToolPanelModule,
  ContextMenuModule,
  ExcelExportModule,
  FiltersToolPanelModule,
  LicenseManager,
  MultiFilterModule,
  PivotModule,
  RowGroupingModule,
  SetFilterModule,
  SideBarModule,
  StatusBarModule,
} from 'ag-grid-enterprise';
import { getConfig } from '../../lib/config/runtimeConfig';

/**
 * The AG Grid modules for the grid features in use (each pulls in its own dependencies): client-side
 * row model and transactions, multi / text / number / date / set filters, quick filter, row grouping
 * with aggregation, pivot mode (columns tool panel), row and cell selection, side bar, status bar,
 * context and column menus, clipboard, CSV / Excel export, the large text editor, row / cell styles,
 * tooltips, column state and autosize. Template `columns` may use any of these.
 * A missing module logs AG Grid console error #200 naming it; the e2e fixture fails on it.
 */
const MODULES: Module[] = [
  ClientSideRowModelModule,
  ClientSideRowModelApiModule,
  RowApiModule,
  CellApiModule,
  ColumnApiModule,
  ColumnAutoSizeModule,
  EventApiModule,
  RenderApiModule,
  ScrollApiModule,
  GridStateModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  CustomFilterModule,
  QuickFilterModule,
  RowSelectionModule,
  RowStyleModule,
  CellStyleModule,
  RowAutoHeightModule,
  TooltipModule,
  TextEditorModule,
  LargeTextEditorModule,
  CsvExportModule,
  // Enterprise
  MultiFilterModule,
  PivotModule,
  SetFilterModule,
  RowGroupingModule,
  AggregationModule,
  CellSelectionModule,
  ClipboardModule,
  ColumnMenuModule,
  ContextMenuModule,
  ColumnsToolPanelModule,
  FiltersToolPanelModule,
  SideBarModule,
  StatusBarModule,
  ExcelExportModule,
  // Descriptive missing-module errors; dev only.
  ...(import.meta.env.DEV ? [ValidationModule] : []),
];

let modulesRegistered = false;

/** Registers the AG Grid modules in use (AG Grid Enterprise only). Idempotent. */
export function registerAgGridModules(): void {
  if (modulesRegistered) return;
  ModuleRegistry.registerModules(MODULES);
  modulesRegistered = true;
}

/**
 * Registers the modules and applies `agGridLicenseKey` when present; without it AG Grid runs as a trial (watermark). Idempotent.
 */
export function initAgGrid(config: { agGridLicenseKey?: string | undefined }): void {
  registerAgGridModules();
  if (config.agGridLicenseKey) LicenseManager.setLicenseKey(config.agGridLicenseKey);
}

/**
 * Called at module scope of `ResultsGrid`, so it runs when the (lazy) grid chunk first loads and
 * before any grid renders; `src/app/main.tsx` must not import AG Grid. An invalid config is
 * reported by the app shell, so here it only means "no licence key".
 */
export function initAgGridFromConfig(): void {
  let config: { agGridLicenseKey?: string | undefined } = {};
  try {
    config = getConfig();
  } catch {
    // reported elsewhere (ConfigError)
  }
  initAgGrid(config);
}
