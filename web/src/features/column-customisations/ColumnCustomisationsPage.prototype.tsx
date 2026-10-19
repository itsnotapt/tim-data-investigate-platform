// PROTOTYPE (wayfinder "Column customisations"): throwaway, in-memory only, never merged.
// Question: what should column customisations look like, how do they map to AG Grid, and does a
// preset keep its column settings (including the hidden Label, Tags and Comment text columns'
// visibility, filters and grouping)?
// Three variants on one route, switchable with ?variant=A|B|C, on a real AG Grid:
//   A  Remembered: AG Grid's own GridState is the format. Each tab keeps its whole grid state, your
//      last layout per action is remembered for the next tab of it, and Save… can put the columns
//      (and optionally the filters) into the preset. No named column views.
//   B  Column views: named views (private or shared, for one action or any) picked in the grid
//      toolbar, with modified / Save / Save as / Revert. A preset references a view.
//   C  Columns table: a layered definition, action file < preset < this tab, edited in a Columns
//      table beside the grid (each value shows where it comes from). Filters never leave the tab.
// "IndexedDB" and the presets are one in-memory object, shown in the State panel. "Reload" re-creates
// every grid from it; "Re-run" changes the current tab's columns (one gone, one new).
// Run with `npm run prototype:column-customisations`.
/* eslint-disable react-hooks/preserve-manual-memoization -- prototype: memo keyed on a JSON string */
import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  ListSubheader,
  Menu,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Tab as MuiTab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  themeBalham,
  type ColDef,
  type ColumnState,
  type GridApi,
  type GridState,
  type SideBarDef,
} from 'ag-grid-community';
import {
  CalculatedColumnsModule,
  ColumnHeaderEditModule,
  RowGroupingPanelModule,
} from 'ag-grid-enterprise';
import { initAgGrid } from '../grid/agGridSetup';
import { PrototypeSwitcher, usePrototypeVariant } from '../../components/PrototypeSwitcher';

initAgGrid({});
// Renaming headers and calculated columns from the column menu (both kept in GridState), and the
// drag-to-group panel.
ModuleRegistry.registerModules([
  ColumnHeaderEditModule,
  CalculatedColumnsModule,
  RowGroupingPanelModule,
]);

const ME = 'you@contoso.com';
const who = (email: string) => (email === ME ? 'you' : email.split('@')[0]!);

// ---------------------------------------------------------------- mock actions (GET /api/instance)

type Kind = 'string' | 'number' | 'datetime';
interface ColSpec {
  name: string;
  type: Kind;
  /** Declared by the action (else inferred by the runner). */
  declared?: boolean;
  // Display hints from the action file.
  hide?: boolean;
  width?: number;
  pinned?: 'left' | 'right';
  header?: string;
}
interface ActionDef {
  key: string;
  name: string;
  idColumn: string | null;
  columns: (drift: boolean) => ColSpec[];
  sort?: { colId: string; sort: 'asc' | 'desc' }[];
}

const ACTIONS: ActionDef[] = [
  {
    key: 'defender-alerts',
    name: 'Defender alerts for device',
    idColumn: 'AlertId',
    sort: [{ colId: 'Timestamp', sort: 'desc' }],
    columns: (drift) =>
      [
        { name: 'Timestamp', type: 'datetime', width: 180, pinned: 'left' },
        { name: 'AlertId', type: 'string', width: 200 },
        { name: 'AlertTitle', type: 'string', width: 260, header: 'Alert' },
        { name: 'Severity', type: 'string', width: 110 },
        { name: 'DeviceName', type: 'string' },
        { name: 'AccountUpn', type: 'string', width: 170 },
        { name: 'FileName', type: 'string' },
        ...(drift ? [] : [{ name: 'SHA256', type: 'string', hide: true } as ColSpec]),
        { name: 'RemoteIP', type: 'string' },
        ...(drift ? [{ name: 'ProcessCommandLine', type: 'string', width: 320 } as ColSpec] : []),
      ].map((c) => ({ ...c, declared: true }) as ColSpec),
  },
  {
    key: 'run-kql',
    name: 'Run KQL',
    idColumn: null,
    // Nothing declared: every column is inferred, so no hints.
    columns: (drift) => [
      { name: 'TimeGenerated', type: 'datetime' },
      { name: 'DeviceName', type: 'string' },
      { name: 'AccountUpn', type: 'string' },
      { name: 'ActionType', type: 'string' },
      { name: 'ProcessCommandLine', type: 'string' },
      { name: 'RemoteIP', type: 'string' },
      ...(drift
        ? [{ name: 'InitiatingProcessFileName', type: 'string' } as ColSpec]
        : [{ name: 'RemotePort', type: 'number' } as ColSpec]),
    ],
  },
];
const actionOf = (key: string) => ACTIONS.find((a) => a.key === key)!;

/** TIM's own columns (Tagging in the grid); colIds can't collide with the action's columns. */
const TIM_COLS = [
  { colId: 'tim:comments', name: 'Comments', type: 'number' as Kind },
  { colId: 'tim:label', name: 'Label', type: 'string' as Kind },
  { colId: 'tim:tags', name: 'Tags', type: 'string' as Kind },
  { colId: 'tim:commentText', name: 'Comment text', type: 'string' as Kind },
];
const timName = (colId: string) => TIM_COLS.find((t) => t.colId === colId)?.name;

// ---------------------------------------------------------------- mock rows and annotations

type Row = Record<string, string | number | null> & { _row: number; id: string | null };
interface Ann {
  label: string | null;
  tags: string[];
  comments: string[];
}

function rng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

function makeRows(action: ActionDef, drift: boolean): { rows: Row[]; anns: Record<string, Ann> } {
  const r = rng(action.key.length * 97 + (drift ? 7 : 1));
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
  const values: Record<string, () => string | number> = {
    Timestamp: () => new Date(Date.parse('2026-10-18T08:00:00Z') - r() * 86_400_000).toISOString(),
    TimeGenerated: () =>
      new Date(Date.parse('2026-10-18T08:00:00Z') - r() * 86_400_000).toISOString(),
    AlertId: () => `da${hex(12)}`,
    AlertTitle: () =>
      pick([
        'Suspicious PowerShell download cradle',
        'Credential dumping via LSASS access',
        'Certutil used to decode payload',
        'Unusual sign-in location',
      ]),
    Severity: () => pick(['High', 'Medium', 'Low']),
    DeviceName: () => pick(['WS-0042', 'WS-0107', 'SRV-DB01', 'LAP-7781']),
    AccountUpn: () => pick(['alex@contoso.com', 'sam@contoso.com', 'priya@contoso.com']),
    FileName: () => pick(['powershell.exe', 'certutil.exe', 'rundll32.exe', 'svc.ps1']),
    SHA256: () => hex(64),
    RemoteIP: () => pick(['185.220.101.7', '45.153.160.2', '10.20.4.17']),
    ProcessCommandLine: () =>
      pick([
        'powershell -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBi…',
        'certutil -decode a.b c.exe',
        'rundll32 shell32.dll,Control_RunDLL',
      ]),
    ActionType: () => pick(['ProcessCreated', 'ConnectionSuccess', 'FileCreated']),
    RemotePort: () => pick([443, 80, 445, 3389]),
    InitiatingProcessFileName: () => pick(['winword.exe', 'explorer.exe', 'cmd.exe']),
  };
  const cols = action.columns(drift);
  const rows: Row[] = [];
  const anns: Record<string, Ann> = {};
  for (let i = 0; i < 60; i++) {
    const row: Row = { _row: i, id: null };
    for (const c of cols) row[c.name] = values[c.name]?.() ?? '';
    const id = action.idColumn ? String(row[action.idColumn]) : `h:${hex(10)}`;
    row.id = id;
    const x = r();
    anns[id] = {
      label: x < 0.15 ? 'Malicious' : x < 0.35 ? 'Suspicious' : x < 0.55 ? 'Benign' : null,
      tags: r() < 0.3 ? [pick(['IR-2291', 'vip', 'known-FP', 'lateral-movement'])] : [],
      comments: r() < 0.2 ? [pick(['seen before on WS-0042', 'asked the owner', 'test box'])] : [],
    };
    rows.push(row);
  }
  return { rows, anns };
}

// ---------------------------------------------------------------- column definitions

/** The action file's hints as ColDefs, plus TIM's columns (Label, Tags and Comment text hidden). */
function baseColDefs(action: ActionDef, drift: boolean, anns: Record<string, Ann>): ColDef<Row>[] {
  const ann = (row: Row | undefined) => (row?.id ? anns[row.id] : undefined);
  const sortOf = (name: string) => action.sort?.find((s) => s.colId === name)?.sort ?? null;
  return [
    {
      colId: 'tim:comments',
      headerName: '💬',
      headerTooltip: 'Comments',
      initialWidth: 60,
      initialPinned: 'left',
      valueGetter: (p) => ann(p.data)?.comments.length || null,
    },
    ...action.columns(drift).map<ColDef<Row>>((c) => ({
      colId: c.name,
      field: c.name,
      headerName: c.header ?? c.name,
      // initial*: the action file's hints apply only where no saved state says otherwise. Plain
      // `sort` / `hide` / … would override restored GridState.
      initialHide: c.hide,
      initialWidth: c.width ?? 150,
      initialPinned: c.pinned,
      initialSort: sortOf(c.name),
      enableRowGroup: true,
      filter: c.type === 'number' ? 'agNumberColumnFilter' : 'agMultiColumnFilter',
      cellStyle:
        c.name === 'SHA256' || c.name === 'AlertId' ? { fontFamily: 'monospace' } : undefined,
    })),
    {
      colId: 'tim:label',
      headerName: 'Label',
      initialHide: true,
      enableRowGroup: true,
      filter: 'agSetColumnFilter',
      valueGetter: (p) => ann(p.data)?.label ?? null,
    },
    {
      colId: 'tim:tags',
      headerName: 'Tags',
      initialHide: true,
      enableRowGroup: true,
      filter: 'agSetColumnFilter',
      valueGetter: (p) => ann(p.data)?.tags.join(', ') || null,
    },
    {
      colId: 'tim:commentText',
      headerName: 'Comment text',
      initialHide: true,
      filter: 'agTextColumnFilter',
      valueGetter: (p) => ann(p.data)?.comments.join(' · ') || null,
    },
  ];
}

// ---------------------------------------------------------------- layouts (GridState subsets)

/** The parts of GridState that are "columns"; filters are kept apart. Selection, focus, scroll
 *  and the side bar never leave the tab. */
const COLUMN_KEYS = [
  'columnOrder',
  'columnSizing',
  'columnVisibility',
  'columnPinning',
  'columnHeaderName',
  'userColumns',
  'sort',
  'rowGroup',
  'aggregation',
  'pivot',
] as const;
type Layout = Pick<GridState, (typeof COLUMN_KEYS)[number] | 'filter'>;

function layoutOf(s: GridState | undefined, withFilters: boolean): Layout {
  const out: Layout = {};
  if (!s) return out;
  for (const k of COLUMN_KEYS) if (s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
  // AG Grid reports the auto group column's header once grouping shows it: not a rename.
  const names = out.columnHeaderName?.columnHeaderNames.filter(
    (h) => !h.colId.startsWith('ag-Grid-'),
  );
  if (names?.length) out.columnHeaderName = { columnHeaderNames: names };
  else delete out.columnHeaderName;
  if (withFilters && s.filter?.filterModel && Object.keys(s.filter.filterModel).length)
    out.filter = { filterModel: s.filter.filterModel };
  return out;
}

const stable = (x: unknown): unknown =>
  Array.isArray(x)
    ? x.map(stable)
    : x && typeof x === 'object'
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, stable((x as Record<string, unknown>)[k])]),
        )
      : x;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(stable(a ?? {})) === JSON.stringify(stable(b ?? {}));
const nameOf = (colId: string) => timName(colId) ?? colId;

/** One line for a layout, e.g. "3 hidden · Timestamp pinned · sorted by Timestamp ↓". */
function summary(l: Layout | undefined, defs?: ColDef<Row>[]): string {
  if (!l || !Object.keys(l).length) return 'action defaults';
  const parts: string[] = [];
  const hidden = l.columnVisibility?.hiddenColIds.filter((c) => !c.startsWith('tim:')) ?? [];
  if (hidden.length) parts.push(`${hidden.length} hidden`);
  const shown = TIM_COLS.filter(
    (t) => t.colId !== 'tim:comments' && !l.columnVisibility?.hiddenColIds.includes(t.colId),
  );
  if (l.columnVisibility && shown.length)
    parts.push(`shows ${shown.map((t) => t.name).join(', ')}`);
  const pinned = l.columnPinning?.leftColIds.filter((c) => c !== 'tim:comments') ?? [];
  if (pinned.length) parts.push(`${pinned.map(nameOf).join(', ')} pinned`);
  const sort = l.sort?.sortModel[0];
  if (sort) parts.push(`sorted by ${nameOf(sort.colId)} ${sort.sort === 'desc' ? '↓' : '↑'}`);
  if (l.rowGroup?.groupColIds.length)
    parts.push(`grouped by ${l.rowGroup.groupColIds.map(nameOf).join(', ')}`);
  const renamed =
    l.columnHeaderName?.columnHeaderNames.filter(
      (h) =>
        !h.colId.startsWith('ag-Grid-') &&
        h.headerName !== defs?.find((d) => d.colId === h.colId)?.headerName,
    ).length ?? 0;
  if (renamed) parts.push(`${renamed} renamed`);
  const calc = l.userColumns?.filter((u) => u.created).length ?? 0;
  if (calc) parts.push(`${calc} calculated`);
  const f = Object.keys(l.filter?.filterModel ?? {});
  if (f.length) parts.push(`filters on ${f.map(nameOf).join(', ')}`);
  return parts.join(' · ') || 'order and widths only';
}

const filterSummary = (s: GridState | undefined) => {
  const f = Object.keys(s?.filter?.filterModel ?? {});
  return f.length ? `filters on ${f.map(nameOf).join(', ')}` : 'no filters';
};

// ---------------------------------------------------------------- C: layered column settings

interface ColSetting {
  hide?: boolean;
  pinned?: 'left' | 'right' | null;
  width?: number;
  sort?: 'asc' | 'desc' | null;
  group?: boolean;
  header?: string;
}
type Overrides = { cols: Record<string, ColSetting>; order?: string[] };
type Layer = 'file' | 'preset' | 'tab';
const LAYER_LETTER: Record<Layer, string> = { file: 'A', preset: 'P', tab: 'T' };
const LAYER_NAME: Record<Layer, string> = {
  file: 'action file',
  preset: 'preset',
  tab: 'this tab',
};
const LAYER_COLOUR: Record<Layer, string> = { file: '#64748b', preset: '#7c3aed', tab: '#0369a1' };
const SETTING_KEYS = ['hide', 'pinned', 'width', 'sort', 'group', 'header'] as const;
type SettingKey = (typeof SETTING_KEYS)[number];

function fileSettings(defs: ColDef<Row>[]): Record<string, ColSetting> {
  const out: Record<string, ColSetting> = {};
  for (const d of defs)
    out[d.colId!] = {
      hide: !!d.initialHide,
      pinned: (d.initialPinned as 'left' | 'right' | null) ?? null,
      width: d.initialWidth ?? 150,
      sort: (d.initialSort as 'asc' | 'desc' | null | undefined) ?? null,
      group: false,
      header: d.headerName,
    };
  return out;
}

/** Effective setting per column, with the layer each value came from. */
function resolveLayers(
  file: Record<string, ColSetting>,
  preset: Overrides | undefined,
  tab: Overrides | undefined,
) {
  const eff: Record<string, ColSetting> = {};
  const from: Record<string, Partial<Record<SettingKey, Layer>>> = {};
  for (const [colId, f] of Object.entries(file)) {
    eff[colId] = { ...f };
    from[colId] = Object.fromEntries(SETTING_KEYS.map((k) => [k, 'file']));
    for (const [layer, o] of [
      ['preset', preset],
      ['tab', tab],
    ] as const) {
      const s = o?.cols[colId];
      if (!s) continue;
      for (const k of SETTING_KEYS)
        if (s[k] !== undefined) {
          (eff[colId] as Record<string, unknown>)[k] = s[k];
          from[colId][k] = layer;
        }
    }
  }
  const order = tab?.order ?? preset?.order ?? Object.keys(file);
  const orderFrom: Layer = tab?.order ? 'tab' : preset?.order ? 'preset' : 'file';
  return { eff, from, order, orderFrom };
}

/** What differs between the grid and the layers below the tab, as tab overrides. */
function diffTab(
  state: ColumnState[],
  below: Record<string, ColSetting>,
  belowOrder: string[],
  prevTab: Overrides | undefined,
): Overrides {
  const cols: Record<string, ColSetting> = {};
  for (const c of state) {
    const b = below[c.colId];
    if (!b) continue;
    const now: ColSetting = {
      hide: !!c.hide,
      pinned: (c.pinned as 'left' | 'right' | null) ?? null,
      width: c.width ?? undefined,
      sort: c.sort ?? null,
      group: !!c.rowGroup,
    };
    const d: ColSetting = {};
    for (const k of ['hide', 'pinned', 'width', 'sort', 'group'] as const)
      if (now[k] !== b[k]) (d as Record<string, unknown>)[k] = now[k];
    // Header names aren't in the grid's column state: keep the tab's own.
    const h = prevTab?.cols[c.colId]?.header;
    if (h !== undefined) d.header = h;
    if (Object.keys(d).length) cols[c.colId] = d;
  }
  const order = state.map((c) => c.colId);
  const sameOrder = same(
    order.filter((c) => belowOrder.includes(c)),
    belowOrder.filter((c) => order.includes(c)),
  );
  return sameOrder ? { cols } : { cols, order };
}

const countOverrides = (o: Overrides | undefined) =>
  Object.values(o?.cols ?? {}).reduce((n, s) => n + Object.keys(s).length, 0) + (o?.order ? 1 : 0);

function overridesYaml(file: Record<string, ColSetting>, o: Overrides): string {
  const lines = ['columns:'];
  for (const [colId, s] of Object.entries(o.cols)) {
    const f = file[colId];
    lines.push(`  - name: ${colId}${f ? '' : '   # not in this result'}`);
    for (const [k, v] of Object.entries(s)) lines.push(`    ${k === 'hide' ? 'hidden' : k}: ${v}`);
  }
  if (o.order) lines.push(`order: [${o.order.join(', ')}]`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- the in-memory "server" and "IndexedDB"

interface Tab {
  id: string;
  title: string;
  action: string;
  preset: string | null;
  drift: boolean;
  /** Bumped to re-create the grid with a new initial state. */
  gen: number;
  /** A: where its starting columns came from. */
  origin?: string;
}

interface View {
  id: string;
  name: string;
  owner: string;
  shared: boolean;
  /** An action key, or null for any action (columns matched by name). */
  scope: string | null;
  withFilters: boolean;
  layout: Layout;
}

interface Preset {
  key: string;
  name: string;
  owner: string;
  shared: boolean;
  action: string;
  /** A: columns (and filters) captured from the grid. */
  layout?: Layout;
  /** B: a reference to a column view. */
  viewId?: string | null;
  /** C: column overrides on top of the action file. */
  overrides?: Overrides;
}

interface Db {
  /** IndexedDB: each tab's grid state (A, B) or tab overrides plus filters (C). */
  tabGrid: Record<string, GridState>;
  tabView: Record<string, string | null>;
  tabOverrides: Record<string, Overrides>;
  /** The grid's layout as it opened (per tab and reset), to tell "changed". */
  tabBase: Record<string, Layout>;
  /** A: IndexedDB, your last layout per action. */
  mine: Record<string, { layout: Layout; fromTab: string }>;
  /** Server: presets and views. */
  presets: Preset[];
  views: View[];
}

const TRIAGE_LAYOUT: Layout = {
  columnVisibility: { hiddenColIds: ['SHA256', 'AlertId', 'tim:tags', 'tim:commentText'] },
  rowGroup: { groupColIds: ['tim:label'] },
  sort: { sortModel: [{ colId: 'Severity', sort: 'asc' }] },
};
const NETWORK_LAYOUT: Layout = {
  columnOrder: {
    orderedColIds: ['tim:comments', 'RemoteIP', 'DeviceName', 'AccountUpn', 'Timestamp'],
  },
  columnPinning: { leftColIds: ['tim:comments', 'RemoteIP'], rightColIds: [] },
  columnVisibility: {
    hiddenColIds: [
      'FileName',
      'SHA256',
      'ProcessCommandLine',
      'tim:label',
      'tim:tags',
      'tim:commentText',
    ],
  },
};

const seedDb = (): Db => ({
  // Tab 1 was opened from "My alert triage".
  tabGrid: { t1: TRIAGE_LAYOUT },
  tabView: { t1: 'v-triage' },
  tabOverrides: {},
  tabBase: {},
  mine: {},
  views: [
    {
      id: 'v-triage',
      name: 'Triage',
      owner: ME,
      shared: false,
      scope: 'defender-alerts',
      withFilters: false,
      layout: TRIAGE_LAYOUT,
    },
    {
      id: 'v-network',
      name: 'Network first',
      owner: 'sam@contoso.com',
      shared: true,
      scope: null,
      withFilters: false,
      layout: NETWORK_LAYOUT,
    },
    {
      id: 'v-open',
      name: 'Unlabelled only',
      owner: ME,
      shared: false,
      scope: null,
      withFilters: true,
      layout: {
        columnVisibility: { hiddenColIds: ['tim:tags', 'tim:commentText'] },
        filter: { filterModel: { 'tim:label': { filterType: 'set', values: [null] } } },
      },
    },
  ],
  presets: [
    {
      key: 'p-mine',
      name: 'My alert triage',
      owner: ME,
      shared: false,
      action: 'defender-alerts',
      layout: TRIAGE_LAYOUT,
      viewId: 'v-triage',
      overrides: {
        cols: {
          SHA256: { hide: false },
          AlertId: { hide: true },
          'tim:label': { hide: false, group: true },
          Severity: { sort: 'asc' },
          Timestamp: { sort: null },
        },
      },
    },
    {
      key: 'p-soc',
      name: 'SOC triage',
      owner: 'sam@contoso.com',
      shared: true,
      action: 'defender-alerts',
      layout: NETWORK_LAYOUT,
      viewId: 'v-sam-private',
      overrides: {
        cols: {
          RemoteIP: { pinned: 'left', width: 140 },
          FileName: { hide: true },
          'tim:tags': { hide: false },
        },
        order: ['tim:comments', 'RemoteIP', 'Timestamp', 'DeviceName', 'AccountUpn'],
      },
    },
  ],
});

// ---------------------------------------------------------------- shared UI

const gridTheme = themeBalham.withParams({ fontSize: 12, headerFontSize: 12, spacing: 5 });

interface GridProps {
  tab: Tab;
  reload: number;
  columnDefs: ColDef<Row>[];
  rows: Row[];
  initialState?: GridState;
  sideBar: string[] | SideBarDef;
  onState?: (s: GridState, initial: boolean) => void;
  onColumns?: (api: GridApi<Row>) => void;
  /** After the first rows render, when the grid's state has settled. */
  onReady?: (api: GridApi<Row>) => void;
}

// Constants: a new object per render makes AG Grid rebuild its columns and side bar.
const DEFAULT_COL_DEF: ColDef<Row> = {
  sortable: true,
  resizable: true,
  filter: true,
  headerNameEditable: true,
  mainMenuItems: [
    'sortAscending',
    'sortDescending',
    'separator',
    'pinSubMenu',
    'autoSizeThis',
    'separator',
    'rowGroup',
    'rowUnGroup',
    'separator',
    'editColumnName',
    'calculatedColumn',
    'editCalculatedColumn',
    'removeCalculatedColumn',
    'separator',
    'columnChooser',
    'resetColumns',
  ],
};
const SIDE_BAR_BOTH = ['columns', 'filters'];
// No defaultToolPanel: the side bar starts closed (the columns table takes the room).
const SIDE_BAR_FILTERS: SideBarDef = { toolPanels: ['filters'] };
const AUTO_GROUP_COL_DEF: ColDef<Row> = { minWidth: 180 };

function Grid(p: GridProps) {
  return (
    <AgGridReact<Row>
      key={`${p.tab.id}:${p.tab.gen}:${p.reload}:${p.tab.drift}`}
      theme={gridTheme}
      rowData={p.rows}
      columnDefs={p.columnDefs}
      defaultColDef={DEFAULT_COL_DEF}
      calculatedColumns
      autoGroupColumnDef={AUTO_GROUP_COL_DEF}
      groupDefaultExpanded={1}
      rowGroupPanelShow="always"
      sideBar={p.sideBar}
      getRowId={(r) => String(r.data._row)}
      initialState={p.initialState}
      onStateUpdated={(e) =>
        p.onState?.(e.state, e.sources.length === 1 && e.sources[0] === 'gridInitializing')
      }
      onFirstDataRendered={(e) => {
        p.onReady?.(e.api);
        p.onColumns?.(e.api);
      }}
      onColumnMoved={(e) => e.finished && p.onColumns?.(e.api)}
      onColumnResized={(e) => e.finished && p.onColumns?.(e.api)}
      onColumnVisible={(e) => p.onColumns?.(e.api)}
      onColumnPinned={(e) => p.onColumns?.(e.api)}
      onSortChanged={(e) => p.onColumns?.(e.api)}
      onColumnRowGroupChanged={(e) => p.onColumns?.(e.api)}
    />
  );
}

function Toolbar({ children }: { children: ReactNode }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', px: 1, py: 0.5, minHeight: 40, flexWrap: 'wrap', rowGap: 0.5 }}
    >
      {children}
    </Stack>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
      {children}
    </Typography>
  );
}

/** Props every variant gets from the page. */
interface Ctx {
  db: Db;
  setDb: (f: (db: Db) => Db) => void;
  tab: Tab;
  updateTab: (patch: Partial<Tab>) => void;
  reload: number;
  rows: Row[];
  defs: ColDef<Row>[];
  saveOpen: boolean;
  setSaveOpen: (open: boolean) => void;
  toast: (text: string) => void;
}

/** Name, visibility and Update / Save as new: the start of the Saved params Save… dialog. */
function SaveShell({
  ctx,
  children,
  onSave,
}: {
  ctx: Ctx;
  children: ReactNode;
  onSave: (p: { name: string; shared: boolean; update: Preset | null }) => void;
}) {
  const own = ctx.db.presets.find((p) => p.key === ctx.tab.preset && p.owner === ME) ?? null;
  const [mode, setMode] = useState<'update' | 'new'>(own ? 'update' : 'new');
  const [name, setName] = useState(own ? own.name : `${actionOf(ctx.tab.action).name} (copy)`);
  const [shared, setShared] = useState(own?.shared ?? false);
  return (
    <Dialog open onClose={() => ctx.setSaveOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle>Save…</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          {own && (
            <RadioGroup
              row
              value={mode}
              onChange={(e) => setMode(e.target.value as 'update' | 'new')}
            >
              <FormControlLabel value="update" control={<Radio />} label={`Update "${own.name}"`} />
              <FormControlLabel value="new" control={<Radio />} label="Save as new" />
            </RadioGroup>
          )}
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              sx={{ flex: 1 }}
            />
            <Select
              size="small"
              value={shared ? 'shared' : 'private'}
              onChange={(e) => setShared(e.target.value === 'shared')}
            >
              <MenuItem value="private">Private</MenuItem>
              <MenuItem value="shared">Shared with everyone</MenuItem>
            </Select>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Params and inputs: as in Saved params (not prototyped here).
          </Typography>
          <Divider />
          {children}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => ctx.setSaveOpen(false)}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!name.trim()}
          onClick={() => {
            onSave({ name: name.trim(), shared, update: mode === 'update' ? own : null });
            ctx.setSaveOpen(false);
          }}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Writes a preset (update or new) and points the tab at it. */
function upsertPreset(
  ctx: Ctx,
  base: { name: string; shared: boolean; update: Preset | null },
  body: Partial<Preset>,
) {
  const key = base.update?.key ?? `p-${Date.now()}`;
  const preset: Preset = {
    ...(base.update ?? { key, owner: ME, action: ctx.tab.action }),
    name: base.name,
    shared: base.shared,
    ...body,
  };
  ctx.setDb((db) => ({
    ...db,
    presets: base.update
      ? db.presets.map((p) => (p.key === key ? preset : p))
      : [...db.presets, preset],
  }));
  ctx.updateTab({ preset: key, title: base.name });
  ctx.toast(`${base.update ? 'Updated' : 'Saved'} "${base.name}"`);
}

// ---------------------------------------------------------------- Variant A: remembered GridState

function VariantA({ ctx }: { ctx: Ctx }) {
  const { db, tab } = ctx;
  const action = actionOf(tab.action);
  const preset = db.presets.find((p) => p.key === tab.preset);
  const grid = db.tabGrid[tab.id];
  const mine = db.mine[tab.action];
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [withCols, setWithCols] = useState(true);
  const [withFilters, setWithFilters] = useState(false);

  const base = db.tabBase[`${tab.id}:${tab.gen}`];
  const changed = !!base && !same(layoutOf(grid, false), base);

  const reset = (to: 'defaults' | 'preset' | 'mine') => {
    const layout = to === 'preset' ? preset?.layout : to === 'mine' ? mine?.layout : undefined;
    ctx.setDb((d) => ({
      ...d,
      // Filters stay; the columns are replaced.
      tabGrid: { ...d.tabGrid, [tab.id]: { ...(layout ?? {}), filter: d.tabGrid[tab.id]?.filter } },
    }));
    ctx.updateTab({ gen: tab.gen + 1, origin: to });
    setMenu(null);
  };

  const originText =
    tab.origin === 'preset'
      ? `from preset "${preset?.name}"`
      : tab.origin === 'mine'
        ? `your last layout for ${action.name}`
        : 'action defaults';

  return (
    <>
      <Toolbar>
        <Chip size="small" label={`Columns: ${originText}${changed ? ' • changed' : ''}`} />
        <Hint>{summary(layoutOf(grid, true), ctx.defs)}</Hint>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          startIcon={<RestartAltIcon />}
          onClick={(e) => setMenu(e.currentTarget)}
        >
          Reset columns
        </Button>
        <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
          <MenuItem onClick={() => reset('defaults')}>
            <Stack>
              <span>Action defaults</span>
              <Hint>from the action file</Hint>
            </Stack>
          </MenuItem>
          {preset?.layout && (
            <MenuItem onClick={() => reset('preset')}>
              <Stack>
                <span>Preset "{preset.name}"</span>
                <Hint>{summary(preset.layout, ctx.defs)}</Hint>
              </Stack>
            </MenuItem>
          )}
          {mine && (
            <MenuItem onClick={() => reset('mine')}>
              <Stack>
                <span>Your last layout for {action.name}</span>
                <Hint>
                  {summary(mine.layout, ctx.defs)} (from {mine.fromTab})
                </Hint>
              </Stack>
            </MenuItem>
          )}
        </Menu>
      </Toolbar>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Grid
          tab={tab}
          reload={ctx.reload}
          rows={ctx.rows}
          columnDefs={ctx.defs}
          initialState={grid}
          sideBar={SIDE_BAR_BOTH}
          onReady={(api) => ctx.setDb((d) => withBase(d, tab, api.getState()))}
          onState={(s, initial) =>
            ctx.setDb((d) => {
              const cols = layoutOf(s, false);
              const settled = !!d.tabBase[`${tab.id}:${tab.gen}`];
              const moved = !same(cols, layoutOf(d.tabGrid[tab.id], false));
              return {
                ...d,
                tabGrid: { ...d.tabGrid, [tab.id]: layoutOf(s, true) },
                // Every column change you make is remembered for the next tab of this action.
                mine:
                  initial || !settled || !moved
                    ? d.mine
                    : { ...d.mine, [tab.action]: { layout: cols, fromTab: tab.title } },
              };
            })
          }
        />
      </Box>
      {ctx.saveOpen && (
        <SaveShell
          ctx={ctx}
          onSave={(base) =>
            upsertPreset(ctx, base, {
              layout: withCols || withFilters ? layoutOf(grid, withFilters) : undefined,
            })
          }
        >
          <FormControlLabel
            control={
              <Checkbox checked={withCols} onChange={(e) => setWithCols(e.target.checked)} />
            }
            label={
              <Stack>
                <span>Keep this tab's columns</span>
                <Hint>{summary(layoutOf(grid, false), ctx.defs)}</Hint>
              </Stack>
            }
          />
          <FormControlLabel
            control={
              <Checkbox checked={withFilters} onChange={(e) => setWithFilters(e.target.checked)} />
            }
            label={
              <Stack>
                <span>Keep this tab's filters</span>
                <Hint>{filterSummary(grid)}</Hint>
              </Stack>
            }
          />
          <Typography variant="caption" color="text.secondary">
            Without either, the preset opens with each analyst's last layout for {action.name}, or
            the action defaults.
          </Typography>
        </SaveShell>
      )}
    </>
  );
}

/** Records the grid's layout as it first opened for this tab and reset. */
function withBase(d: Db, tab: Tab, s: GridState): Db {
  const k = `${tab.id}:${tab.gen}`;
  return d.tabBase[k] ? d : { ...d, tabBase: { ...d.tabBase, [k]: layoutOf(s, false) } };
}

// ---------------------------------------------------------------- Variant B: named column views

function VariantB({ ctx }: { ctx: Ctx }) {
  const { db, tab } = ctx;
  const action = actionOf(tab.action);
  const grid = db.tabGrid[tab.id];
  const viewId = db.tabView[tab.id] ?? null;
  const view = db.views.find((v) => v.id === viewId) ?? null;
  const preset = db.presets.find((p) => p.key === tab.preset);
  const missingView = preset?.viewId && !db.views.some((v) => v.id === preset.viewId);
  const visible = db.views.filter((v) => v.owner === ME || v.shared);
  const forAction = visible.filter((v) => v.scope === tab.action);
  const anyAction = visible.filter((v) => v.scope === null);
  const [saveAs, setSaveAs] = useState(false);
  const [presetView, setPresetView] = useState<string | null>(viewId);

  const base = db.tabBase[`${tab.id}:${tab.gen}`];
  const modified = !!base && !same(layoutOf(grid, false), base);
  const colIds = new Set(ctx.defs.map((d) => d.colId));
  const unknown = view
    ? [
        ...new Set([
          ...(view.layout.columnVisibility?.hiddenColIds ?? []),
          ...(view.layout.columnOrder?.orderedColIds ?? []),
        ]),
      ].filter((c) => !colIds.has(c))
    : [];

  const apply = (id: string | null) => {
    const v = db.views.find((x) => x.id === id);
    ctx.setDb((d) => ({
      ...d,
      tabView: { ...d.tabView, [tab.id]: id },
      tabGrid: {
        ...d.tabGrid,
        // A view without filters keeps the tab's filters.
        [tab.id]: { ...(v?.layout ?? {}), filter: v?.withFilters ? v.layout.filter : grid?.filter },
      },
    }));
    ctx.updateTab({ gen: tab.gen + 1 });
  };

  return (
    <>
      <Toolbar>
        <Select
          size="small"
          value={viewId ?? '__default'}
          onChange={(e) => apply(e.target.value === '__default' ? null : e.target.value)}
          renderValue={() => (
            <span>
              Column view: <b>{view?.name ?? 'Action default'}</b>
              {modified && ' •'}
            </span>
          )}
          sx={{ minWidth: 240 }}
        >
          <MenuItem value="__default">Action default</MenuItem>
          <ListSubheader>For {action.name}</ListSubheader>
          {forAction.map((v) => (
            <MenuItem key={v.id} value={v.id}>
              {v.name}
              <Box sx={{ ml: 1 }}>
                <Hint>
                  {v.owner === ME ? (v.shared ? 'shared' : 'private') : `${who(v.owner)}, shared`}
                </Hint>
              </Box>
            </MenuItem>
          ))}
          {forAction.length === 0 && (
            <MenuItem disabled>
              <Hint>none yet</Hint>
            </MenuItem>
          )}
          <ListSubheader>Any action (matched by column name)</ListSubheader>
          {anyAction.map((v) => (
            <MenuItem key={v.id} value={v.id}>
              {v.name}
              <Box sx={{ ml: 1 }}>
                <Hint>
                  {v.owner === ME ? (v.shared ? 'shared' : 'private') : `${who(v.owner)}, shared`}
                  {v.withFilters && ', with filters'}
                </Hint>
              </Box>
            </MenuItem>
          ))}
        </Select>
        {modified && <Hint>modified</Hint>}
        <Button
          size="small"
          disabled={!view || view.owner !== ME || !modified}
          onClick={() =>
            ctx.setDb((d) => ({
              ...d,
              views: d.views.map((v) =>
                v.id === view!.id ? { ...v, layout: layoutOf(grid, v.withFilters) } : v,
              ),
              tabBase: { ...d.tabBase, [`${tab.id}:${tab.gen}`]: layoutOf(grid, false) },
            }))
          }
        >
          Save view
        </Button>
        <Button size="small" onClick={() => setSaveAs(true)}>
          Save as view…
        </Button>
        <Button size="small" disabled={!modified} onClick={() => apply(viewId)}>
          Revert
        </Button>
        {view && view.owner === ME && (
          <Button
            size="small"
            color="error"
            onClick={() => {
              ctx.setDb((d) => ({ ...d, views: d.views.filter((v) => v.id !== view.id) }));
              ctx.toast(
                `Deleted view "${view.name}"; presets pointing at it fall back to the default`,
              );
            }}
          >
            Delete view
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {unknown.length > 0 && (
          <Hint>
            {unknown.length} of this view's columns aren't in this result ({unknown.join(', ')})
          </Hint>
        )}
        {missingView && (
          <Alert severity="warning" sx={{ py: 0 }}>
            "{preset.name}" uses a column view you can't see (private to {who(preset.owner)}, or
            deleted): showing the action default.
          </Alert>
        )}
      </Toolbar>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Grid
          tab={tab}
          reload={ctx.reload}
          rows={ctx.rows}
          columnDefs={ctx.defs}
          initialState={grid}
          sideBar={SIDE_BAR_BOTH}
          onReady={(api) => ctx.setDb((d) => withBase(d, tab, api.getState()))}
          onState={(s) =>
            ctx.setDb((d) => ({ ...d, tabGrid: { ...d.tabGrid, [tab.id]: layoutOf(s, true) } }))
          }
        />
      </Box>
      {saveAs && (
        <SaveViewDialog
          action={action}
          grid={grid}
          onClose={() => setSaveAs(false)}
          onSave={(v) => {
            const id = `v-${Date.now()}`;
            ctx.setDb((d) => ({
              ...d,
              views: [...d.views, { ...v, id, owner: ME, layout: layoutOf(grid, v.withFilters) }],
              tabView: { ...d.tabView, [tab.id]: id },
              tabBase: { ...d.tabBase, [`${tab.id}:${tab.gen}`]: layoutOf(grid, false) },
            }));
            setSaveAs(false);
          }}
        />
      )}
      {ctx.saveOpen && (
        <SaveShell ctx={ctx} onSave={(base) => upsertPreset(ctx, base, { viewId: presetView })}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2">Column view</Typography>
            <Select
              size="small"
              value={presetView ?? '__default'}
              onChange={(e) =>
                setPresetView(e.target.value === '__default' ? null : e.target.value)
              }
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="__default">Action default</MenuItem>
              {[...forAction, ...anyAction].map((v) => (
                <MenuItem key={v.id} value={v.id}>
                  {v.name}
                </MenuItem>
              ))}
            </Select>
          </Stack>
          {modified && (
            <Alert severity="info" sx={{ py: 0 }}>
              This tab's column changes aren't in "{view?.name ?? 'Action default'}": save the view
              first to keep them.
            </Alert>
          )}
          {presetView && db.views.find((v) => v.id === presetView)?.shared === false && (
            <Alert severity="warning" sx={{ py: 0 }}>
              The view is private: if you share this preset, others get the action default.
            </Alert>
          )}
          <Typography variant="caption" color="text.secondary">
            The preset points at the view: later changes to the view change the preset too. Filters
            come with the view only if it keeps them.
          </Typography>
        </SaveShell>
      )}
    </>
  );
}

function SaveViewDialog({
  action,
  grid,
  onClose,
  onSave,
}: {
  action: ActionDef;
  grid: GridState | undefined;
  onClose: () => void;
  onSave: (v: Omit<View, 'id' | 'owner' | 'layout'>) => void;
}) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'action' | 'any'>('action');
  const [shared, setShared] = useState(false);
  const [withFilters, setWithFilters] = useState(false);
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Save as column view</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ pt: 1 }}>
          <TextField
            size="small"
            autoFocus
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Hint>{summary(layoutOf(grid, withFilters))}</Hint>
          <RadioGroup value={scope} onChange={(e) => setScope(e.target.value as 'action' | 'any')}>
            <FormControlLabel value="action" control={<Radio />} label={`For ${action.name}`} />
            <FormControlLabel
              value="any"
              control={<Radio />}
              label="For any action (matched by column name)"
            />
          </RadioGroup>
          <FormControlLabel
            control={
              <Checkbox checked={withFilters} onChange={(e) => setWithFilters(e.target.checked)} />
            }
            label={`Keep filters (${filterSummary(grid)})`}
          />
          <FormControlLabel
            control={<Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)} />}
            label="Shared with everyone"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!name.trim()}
          onClick={() =>
            onSave({
              name: name.trim(),
              shared,
              scope: scope === 'action' ? action.key : null,
              withFilters,
            })
          }
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Variant C: columns table

function VariantC({ ctx }: { ctx: Ctx }) {
  const { db, tab } = ctx;
  const action = actionOf(tab.action);
  const preset = db.presets.find((p) => p.key === tab.preset);
  const [panel, setPanel] = useState(true);
  const [yaml, setYaml] = useState(false);

  const file = useMemo(() => fileSettings(ctx.defs), [ctx.defs]);
  const tabO = db.tabOverrides[tab.id];
  const presetO = preset?.overrides;
  const { eff, from, order, orderFrom } = resolveLayers(file, presetO, tabO);
  const below = resolveLayers(file, presetO, undefined);
  const decl = new Map(action.columns(tab.drift).map((c) => [c.name, c]));

  // The layers become ColDefs (AG Grid applies changed stateful attributes); the grid's own
  // changes come back through onColumns as this tab's overrides.
  const effKey = JSON.stringify({ eff, order });
  const defs = useMemo(() => {
    const e = JSON.parse(effKey) as { eff: Record<string, ColSetting>; order: string[] };
    const byId = new Map(ctx.defs.map((d) => [d.colId!, d]));
    const ids = [
      ...e.order.filter((c) => byId.has(c)),
      ...ctx.defs.map((d) => d.colId!).filter((c) => !e.order.includes(c)),
    ];
    const groups = ids.filter((c) => e.eff[c]?.group);
    return ids.map<ColDef<Row>>((c) => {
      const d = byId.get(c)!;
      const st = e.eff[c] ?? {};
      return {
        ...d,
        headerName: st.header ?? d.headerName,
        hide: !!st.hide,
        pinned: st.pinned ?? null,
        width: st.width,
        sort: st.sort ?? null,
        rowGroup: !!st.group,
        rowGroupIndex: st.group ? groups.indexOf(c) : null,
      };
    });
  }, [ctx.defs, effKey]);

  const setTabO = (o: Overrides | undefined) => {
    ctx.setDb((d) => {
      const next = { ...d.tabOverrides };
      if (o && countOverrides(o)) next[tab.id] = o;
      else delete next[tab.id];
      return { ...d, tabOverrides: next };
    });
  };

  const edit = (colId: string, k: SettingKey, v: unknown) => {
    const cur: Overrides = tabO ?? { cols: {} };
    const col = { ...(cur.cols[colId] ?? {}) };
    if (v === (below.eff[colId] as Record<string, unknown> | undefined)?.[k])
      delete (col as Record<string, unknown>)[k];
    else (col as Record<string, unknown>)[k] = v;
    const cols = { ...cur.cols, [colId]: col };
    if (!Object.keys(col).length) delete cols[colId];
    const next = { ...cur, cols };
    setTabO(next);
  };

  const resetCell = (colId: string, k: SettingKey) => {
    if (!tabO?.cols[colId]) return;
    const col = { ...tabO.cols[colId] };
    delete (col as Record<string, unknown>)[k];
    const cols = { ...tabO.cols, [colId]: col };
    if (!Object.keys(col).length) delete cols[colId];
    const next = { ...tabO, cols };
    setTabO(next);
  };

  const cell = (colId: string, k: SettingKey, control: ReactNode) => {
    const layer = from[colId]?.[k] ?? 'file';
    return (
      <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
        {control}
        <Tooltip title={`From ${LAYER_NAME[layer]}${layer === 'tab' ? ' (click to reset)' : ''}`}>
          <Box
            component="span"
            onClick={() => layer === 'tab' && resetCell(colId, k)}
            sx={{
              fontSize: 9,
              fontWeight: 700,
              color: '#fff',
              background: LAYER_COLOUR[layer],
              borderRadius: 0.5,
              px: 0.4,
              cursor: layer === 'tab' ? 'pointer' : 'default',
              opacity: layer === 'file' ? 0.35 : 1,
            }}
          >
            {LAYER_LETTER[layer]}
          </Box>
        </Tooltip>
      </Stack>
    );
  };

  const shownOrder = [
    ...order.filter((c) => eff[c]),
    ...Object.keys(eff).filter((c) => !order.includes(c)),
  ];

  return (
    <>
      <Toolbar>
        <Chip
          size="small"
          sx={{ background: LAYER_COLOUR.file, color: '#fff' }}
          label={`A action file`}
        />
        <Chip
          size="small"
          sx={{ background: LAYER_COLOUR.preset, color: '#fff', opacity: preset ? 1 : 0.4 }}
          label={
            preset ? `P preset "${preset.name}": ${countOverrides(presetO)} changes` : 'P no preset'
          }
        />
        <Chip
          size="small"
          sx={{ background: LAYER_COLOUR.tab, color: '#fff' }}
          label={`T this tab: ${countOverrides(tabO)} changes`}
          onDelete={tabO ? () => setTabO(undefined) : undefined}
        />
        <Hint>{filterSummary(db.tabGrid[tab.id])} (filters stay with the tab)</Hint>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={() => setYaml(true)}>
          Copy as action file
        </Button>
        <Button size="small" onClick={() => setPanel((p) => !p)}>
          {panel ? 'Hide' : 'Show'} columns table
        </Button>
      </Toolbar>
      <Stack direction="row" sx={{ flex: 1, minHeight: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Grid
            tab={tab}
            reload={ctx.reload}
            rows={ctx.rows}
            columnDefs={defs}
            // Filters are the only grid state kept as such; columns come from the layers.
            initialState={{ filter: db.tabGrid[tab.id]?.filter }}
            sideBar={SIDE_BAR_FILTERS}
            onState={(s) =>
              ctx.setDb((d) => ({
                ...d,
                tabGrid: { ...d.tabGrid, [tab.id]: { filter: layoutOf(s, true).filter } },
              }))
            }
            onColumns={(api) => {
              const next = diffTab(api.getColumnState(), below.eff, below.order, tabO);
              if (!same(next, tabO ?? { cols: {} })) setTabO(next);
            }}
          />
        </Box>
        {panel && (
          <Box
            sx={{
              width: 560,
              borderLeft: 1,
              borderColor: 'divider',
              overflow: 'auto',
              fontSize: 12,
            }}
          >
            <Box sx={{ p: 1 }}>
              <Typography variant="subtitle2">Columns</Typography>
              <Hint>
                Order from {LAYER_NAME[orderFrom]} (drag headers in the grid). Each value shows its
                layer; click a T to reset it.
              </Hint>
            </Box>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748b' }}>
                  {['Column', 'Type', 'Header', 'Shown', 'Pinned', 'Width', 'Sort', 'Group'].map(
                    (h) => (
                      <th key={h} style={{ padding: '2px 4px', fontWeight: 600 }}>
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {shownOrder.map((colId) => {
                  const s = eff[colId]!;
                  const d = decl.get(colId);
                  const src = colId.startsWith('tim:')
                    ? 'TIM'
                    : d?.declared
                      ? 'declared'
                      : 'inferred';
                  return (
                    <tr key={colId} style={{ borderTop: '1px solid rgba(127,127,127,.2)' }}>
                      <td style={{ padding: '2px 4px', whiteSpace: 'nowrap' }}>
                        {nameOf(colId)}
                        <div style={{ fontSize: 10, color: '#94a3b8' }}>{src}</div>
                      </td>
                      <td style={{ padding: '2px 4px' }}>
                        {d?.type ?? TIM_COLS.find((t) => t.colId === colId)?.type}
                      </td>
                      <td style={{ padding: '2px 4px' }}>
                        {cell(
                          colId,
                          'header',
                          <input
                            style={{ width: 90, font: 'inherit' }}
                            value={s.header ?? ''}
                            onChange={(e) => edit(colId, 'header', e.target.value)}
                          />,
                        )}
                      </td>
                      <td style={{ padding: '2px 4px' }}>
                        {cell(
                          colId,
                          'hide',
                          <input
                            type="checkbox"
                            checked={!s.hide}
                            onChange={(e) => edit(colId, 'hide', !e.target.checked)}
                          />,
                        )}
                      </td>
                      <td style={{ padding: '2px 4px' }}>
                        {cell(
                          colId,
                          'pinned',
                          <select
                            value={s.pinned ?? ''}
                            onChange={(e) => edit(colId, 'pinned', e.target.value || null)}
                          >
                            <option value="">–</option>
                            <option value="left">left</option>
                            <option value="right">right</option>
                          </select>,
                        )}
                      </td>
                      <td style={{ padding: '2px 4px' }}>
                        {cell(
                          colId,
                          'width',
                          <input
                            type="number"
                            style={{ width: 48, font: 'inherit' }}
                            value={s.width ?? ''}
                            onChange={(e) =>
                              edit(colId, 'width', Number(e.target.value) || undefined)
                            }
                          />,
                        )}
                      </td>
                      <td style={{ padding: '2px 4px' }}>
                        {cell(
                          colId,
                          'sort',
                          <select
                            value={s.sort ?? ''}
                            onChange={(e) => edit(colId, 'sort', e.target.value || null)}
                          >
                            <option value="">–</option>
                            <option value="asc">↑</option>
                            <option value="desc">↓</option>
                          </select>,
                        )}
                      </td>
                      <td style={{ padding: '2px 4px' }}>
                        {cell(
                          colId,
                          'group',
                          <input
                            type="checkbox"
                            checked={!!s.group}
                            onChange={(e) => edit(colId, 'group', e.target.checked)}
                          />,
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>
        )}
      </Stack>
      {yaml && (
        <Dialog open onClose={() => setYaml(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Copy as action file (for an admin)</DialogTitle>
          <DialogContent>
            <Hint>
              The preset's and this tab's changes, as `columns:` hints in {action.name}'s file.
            </Hint>
            <pre style={{ fontSize: 12 }}>{overridesYaml(file, mergeOverrides(presetO, tabO))}</pre>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setYaml(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}
      {ctx.saveOpen && (
        <SaveShell
          ctx={ctx}
          onSave={(base) => {
            upsertPreset(ctx, base, { overrides: mergeOverrides(presetO, tabO) });
            // The tab's changes now live in the preset.
            setTabO(undefined);
          }}
        >
          <Typography variant="body2">
            Columns: the preset keeps {countOverrides(mergeOverrides(presetO, tabO))} changes from
            the action file
            {preset &&
              countOverrides(presetO) > 0 &&
              ` (${countOverrides(presetO)} already in "${preset.name}")`}
            .
          </Typography>
          <pre style={{ fontSize: 11, margin: 0, maxHeight: 160, overflow: 'auto' }}>
            {overridesYaml(file, mergeOverrides(presetO, tabO))}
          </pre>
          <Typography variant="caption" color="text.secondary">
            Filters ({filterSummary(db.tabGrid[tab.id])}) stay with this tab: a preset never filters
            rows out.
          </Typography>
        </SaveShell>
      )}
    </>
  );
}

function mergeOverrides(a: Overrides | undefined, b: Overrides | undefined): Overrides {
  const cols: Record<string, ColSetting> = { ...(a?.cols ?? {}) };
  for (const [k, v] of Object.entries(b?.cols ?? {})) cols[k] = { ...(cols[k] ?? {}), ...v };
  const order = b?.order ?? a?.order;
  return order ? { cols, order } : { cols };
}

// ---------------------------------------------------------------- page

const VARIANTS = [
  { key: 'A', name: 'Remembered (GridState)' },
  { key: 'B', name: 'Column views' },
  { key: 'C', name: 'Columns table, layered' },
];
const VARIANT_KEYS = VARIANTS.map((v) => v.key);

let tabSeq = 0;

export function ColumnCustomisationsPage() {
  const variant = usePrototypeVariant(VARIANT_KEYS);
  // Each variant starts from a fresh "IndexedDB" and server.
  return <Page key={variant} variant={variant} />;
}

function Page({ variant }: { variant: string }) {
  const [db, setDb] = useState<Db>(seedDb);
  const [tabs, setTabs] = useState<Tab[]>(() => [
    {
      id: 't1',
      title: 'My alert triage',
      action: 'defender-alerts',
      preset: 'p-mine',
      drift: false,
      gen: 0,
      origin: 'preset',
    },
    {
      id: 't2',
      title: 'Defender alerts for device: WS-0042',
      action: 'defender-alerts',
      preset: null,
      drift: false,
      gen: 0,
      origin: 'defaults',
    },
    {
      id: 't3',
      title: 'Run KQL',
      action: 'run-kql',
      preset: null,
      drift: false,
      gen: 0,
      origin: 'defaults',
    },
  ]);
  const [current, setCurrent] = useState('t1');
  const [reload, setReload] = useState(0);
  const [saveOpen, setSaveOpen] = useState(false);
  const [newMenu, setNewMenu] = useState<HTMLElement | null>(null);
  const [showState, setShowState] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const tab = tabs.find((t) => t.id === current) ?? tabs[0]!;
  const action = actionOf(tab.action);
  const data = useMemo(() => makeRows(action, tab.drift), [action, tab.drift]);
  const defs = useMemo(
    () => baseColDefs(action, tab.drift, data.anns),
    [action, tab.drift, data.anns],
  );

  const updateTab = (patch: Partial<Tab>) =>
    setTabs((ts) => ts.map((t) => (t.id === tab.id ? { ...t, ...patch } : t)));

  const open = (actionKey: string, presetKey: string | null) => {
    const id = `t${++tabSeq + 3}`;
    const p = db.presets.find((x) => x.key === presetKey);
    const a = actionOf(actionKey);
    // A: preset's columns, else your last layout for the action, else the action defaults.
    let origin = 'defaults';
    let start: GridState | undefined;
    if (p?.layout) {
      origin = 'preset';
      start = p.layout;
    } else if (db.mine[actionKey]) {
      origin = 'mine';
      start = db.mine[actionKey].layout;
    }
    // B: the preset's view, if you can see it.
    const v = db.views.find((x) => x.id === p?.viewId && (x.owner === ME || x.shared));
    setDb((d) => ({
      ...d,
      tabGrid: {
        ...d.tabGrid,
        [id]: variant === 'B' ? (v?.layout ?? {}) : variant === 'A' ? (start ?? {}) : {},
      },
      tabView: { ...d.tabView, [id]: v?.id ?? null },
    }));
    setTabs((ts) => [
      ...ts,
      {
        id,
        title: p?.name ?? a.name,
        action: actionKey,
        preset: presetKey,
        drift: false,
        gen: 0,
        origin,
      },
    ]);
    setCurrent(id);
    setNewMenu(null);
  };

  const ctx: Ctx = {
    db,
    setDb,
    tab,
    updateTab,
    reload,
    rows: data.rows,
    defs,
    saveOpen,
    setSaveOpen,
    toast: (t) => {
      setToast(t);
      setTimeout(() => setToast(null), 4000);
    },
  };

  const stateView = {
    variant,
    [`tab ${tab.id} (IndexedDB)`]:
      variant === 'B'
        ? { view: db.tabView[tab.id] ?? null, grid: db.tabGrid[tab.id] }
        : variant === 'C'
          ? { overrides: db.tabOverrides[tab.id], filter: db.tabGrid[tab.id]?.filter }
          : db.tabGrid[tab.id],
    ...(variant !== 'C'
      ? { 'as opened (to tell "changed")': db.tabBase[`${tab.id}:${tab.gen}`] }
      : {}),
    ...(variant === 'A' ? { 'mine (IndexedDB, per action)': db.mine } : {}),
    ...(variant === 'B' ? { 'views (server)': db.views } : {}),
    'presets (server)': db.presets.map((p) => ({
      key: p.key,
      name: p.name,
      owner: p.owner,
      shared: p.shared,
      action: p.action,
      ...(variant === 'A'
        ? { layout: p.layout }
        : variant === 'B'
          ? { viewId: p.viewId }
          : { overrides: p.overrides }),
    })),
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" sx={{ alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={tab.id}
          onChange={(_, v: string) => setCurrent(v)}
          variant="scrollable"
          sx={{ flex: 1 }}
        >
          {tabs.map((t) => (
            <MuiTab
              key={t.id}
              value={t.id}
              sx={{ textTransform: 'none', minHeight: 40, py: 0 }}
              label={
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <span>{t.title}</span>
                  {tabs.length > 1 && (
                    <CloseIcon
                      sx={{ fontSize: 14 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTabs((ts) => ts.filter((x) => x.id !== t.id));
                        if (current === t.id) setCurrent(tabs.find((x) => x.id !== t.id)!.id);
                      }}
                    />
                  )}
                </Stack>
              }
            />
          ))}
        </Tabs>
        <IconButton size="small" onClick={(e) => setNewMenu(e.currentTarget)} title="New">
          <AddIcon />
        </IconButton>
        <Menu anchorEl={newMenu} open={!!newMenu} onClose={() => setNewMenu(null)}>
          <ListSubheader>Actions</ListSubheader>
          {ACTIONS.map((a) => (
            <MenuItem key={a.key} onClick={() => open(a.key, null)}>
              {a.name}
            </MenuItem>
          ))}
          <ListSubheader>Presets</ListSubheader>
          {db.presets
            .filter((p) => p.owner === ME || p.shared)
            .map((p) => (
              <MenuItem key={p.key} onClick={() => open(p.action, p.key)}>
                {p.name}
                <Box sx={{ ml: 1 }}>
                  <Hint>
                    {p.owner === ME ? (p.shared ? 'shared' : 'private') : `${who(p.owner)}, shared`}
                  </Hint>
                </Box>
              </MenuItem>
            ))}
        </Menu>
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <Typography variant="body2" color="text.secondary">
          {action.name}
          {tab.preset && ` · preset "${db.presets.find((p) => p.key === tab.preset)?.name}"`}
          {tab.drift && ' · re-run: columns changed'}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" onClick={() => setSaveOpen(true)}>
          Save…
        </Button>
      </Stack>
      <Stack direction="row" sx={{ flex: 1, minHeight: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {variant === 'A' && <VariantA key={`${variant}:${tab.id}`} ctx={ctx} />}
          {variant === 'B' && <VariantB key={`${variant}:${tab.id}`} ctx={ctx} />}
          {variant === 'C' && <VariantC key={`${variant}:${tab.id}`} ctx={ctx} />}
        </Box>
        {showState && (
          <Box
            sx={{
              width: 360,
              borderLeft: 1,
              borderColor: 'divider',
              overflow: 'auto',
              p: 1,
              pb: 8,
              background: 'rgba(127,127,127,.06)',
            }}
          >
            <Typography variant="subtitle2">State</Typography>
            <pre
              style={{ fontSize: 10.5, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
            >
              {JSON.stringify(stateView, null, 1)}
            </pre>
          </Box>
        )}
      </Stack>
      {toast && (
        <Alert
          severity="success"
          sx={{ position: 'fixed', bottom: 64, left: 16, zIndex: 1500 }}
          onClose={() => setToast(null)}
        >
          {toast}
        </Alert>
      )}
      <PrototypeSwitcher
        variants={VARIANTS}
        state={
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => setReload((r) => r + 1)}
              title="Re-create every grid from IndexedDB"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => updateTab({ drift: !tab.drift })}
              title="Re-run the tab: one column goes, one appears"
            >
              Re-run {tab.drift ? '(back)' : '(columns change)'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDb(seedDb());
                setReload((r) => r + 1);
              }}
            >
              Wipe
            </button>
            <button type="button" onClick={() => setShowState((s) => !s)}>
              State
            </button>
          </span>
        }
      />
    </Box>
  );
}
