import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerModules = vi.fn();
const setLicenseKey = vi.fn();
const getConfig = vi.fn();
const mod = (moduleName: string) => ({ moduleName });

vi.mock('ag-grid-community', () => ({
  ModuleRegistry: { registerModules },
  ClientSideRowModelModule: mod('ClientSideRowModelModule'),
  RowSelectionModule: mod('RowSelectionModule'),
  ValidationModule: mod('ValidationModule'),
  // Every other community module is just a named stub.
  ...Object.fromEntries(
    [
      'CellApiModule',
      'CellStyleModule',
      'ClientSideRowModelApiModule',
      'ColumnApiModule',
      'ColumnAutoSizeModule',
      'CsvExportModule',
      'CustomFilterModule',
      'DateFilterModule',
      'EventApiModule',
      'GridStateModule',
      'LargeTextEditorModule',
      'NumberFilterModule',
      'QuickFilterModule',
      'RenderApiModule',
      'RowApiModule',
      'RowAutoHeightModule',
      'RowStyleModule',
      'ScrollApiModule',
      'TextEditorModule',
      'TextFilterModule',
      'TooltipModule',
    ].map((n) => [n, mod(n)]),
  ),
}));
vi.mock('ag-grid-enterprise', () => ({
  LicenseManager: { setLicenseKey },
  ...Object.fromEntries(
    [
      'AggregationModule',
      'CellSelectionModule',
      'ClipboardModule',
      'ColumnMenuModule',
      'ColumnsToolPanelModule',
      'ContextMenuModule',
      'ExcelExportModule',
      'FiltersToolPanelModule',
      'MultiFilterModule',
      'PivotModule',
      'RowGroupingModule',
      'SetFilterModule',
      'SideBarModule',
      'StatusBarModule',
    ].map((n) => [n, mod(n)]),
  ),
}));
vi.mock('../../lib/config/runtimeConfig', () => ({ getConfig }));

beforeEach(() => {
  vi.resetModules();
  registerModules.mockClear();
  setLicenseKey.mockClear();
  getConfig.mockReset();
});

async function load() {
  return import('./agGridSetup');
}

function registeredNames(): string[] {
  return (registerModules.mock.calls[0]?.[0] as { moduleName: string }[]).map((m) => m.moduleName);
}

describe('initAgGrid', () => {
  it('registers the modules once however often it is called', async () => {
    const { initAgGrid } = await load();
    initAgGrid({});
    initAgGrid({});
    expect(registerModules).toHaveBeenCalledTimes(1);
    const names = registeredNames();
    expect(names).toEqual(
      expect.arrayContaining([
        'ClientSideRowModelModule',
        'RowSelectionModule',
        'RowGroupingModule',
        'SetFilterModule',
        'MultiFilterModule',
        'SideBarModule',
        'StatusBarModule',
        'ContextMenuModule',
        'ClipboardModule',
        'ExcelExportModule',
        'CellSelectionModule',
        'PivotModule',
      ]),
    );
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain('AllEnterpriseModule');
  });

  it('adds the descriptive-errors ValidationModule in dev only', async () => {
    const { registerAgGridModules } = await load();
    registerAgGridModules();
    expect(registeredNames().includes('ValidationModule')).toBe(import.meta.env.DEV);
  });

  it('sets the licence key when one is configured', async () => {
    const { initAgGrid } = await load();
    initAgGrid({ agGridLicenseKey: 'key-1' });
    expect(setLicenseKey).toHaveBeenCalledWith('key-1');
  });

  it('does not set a licence key when none is configured', async () => {
    const { initAgGrid } = await load();
    initAgGrid({});
    initAgGrid({ agGridLicenseKey: '' });
    expect(setLicenseKey).not.toHaveBeenCalled();
  });
});

describe('initAgGridFromConfig', () => {
  it('applies the licence key from the runtime config', async () => {
    getConfig.mockReturnValue({ agGridLicenseKey: 'key-2' });
    const { initAgGridFromConfig } = await load();
    initAgGridFromConfig();
    expect(registerModules).toHaveBeenCalledTimes(1);
    expect(setLicenseKey).toHaveBeenCalledWith('key-2');
  });

  it('still registers the modules when the config is invalid', async () => {
    getConfig.mockImplementation(() => {
      throw new Error('bad config');
    });
    const { initAgGridFromConfig } = await load();
    expect(() => initAgGridFromConfig()).not.toThrow();
    expect(registerModules).toHaveBeenCalledTimes(1);
    expect(setLicenseKey).not.toHaveBeenCalled();
  });
});
