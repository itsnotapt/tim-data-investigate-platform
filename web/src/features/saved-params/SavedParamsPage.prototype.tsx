// PROTOTYPE (wayfinder "Saved params"): throwaway, in-memory only, never merged.
// Question: how do analysts create, share and manage saved params, including saved
// queries that become pivots? Actions are admin-authored; saved params are analyst data.
// Every input (an action param with from_columns, or a query parameter) is either Fixed (its
// value is saved) or From row (filled from the clicked row; the tab's value is only a test value).
// Run with `npm run prototype:saved-params`; ◀ ▶ (or arrow keys) switch variants.
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import {
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
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined';
import { PrototypeSwitcher, usePrototypeVariant } from '../../components/PrototypeSwitcher';

// ---------------------------------------------------------------- mock catalogue

type Kind = 'connection' | 'string' | 'kql' | 'sql' | 'datetime' | 'choice';
interface ParamDef {
  name: string;
  label: string;
  kind: Kind;
  required?: boolean;
  default?: string;
  choices?: string[];
  fromColumns?: string[];
  many?: boolean;
}
interface ActionDef {
  key: string;
  name: string;
  menu: string;
  source: string;
  params: ParamDef[];
}

const ACTIONS: ActionDef[] = [
  {
    key: 'run_kql',
    name: 'Run KQL',
    menu: 'Kusto',
    source: 'built-in',
    params: [
      {
        name: 'connection',
        label: 'Connection',
        kind: 'connection',
        required: true,
        choices: ['security-prod', 'security-dev'],
        default: 'security-prod',
      },
      {
        name: 'database',
        label: 'Database',
        kind: 'string',
        required: true,
        default: 'SecurityLogs',
      },
      {
        name: 'kql',
        label: 'KQL',
        kind: 'kql',
        required: true,
        default: 'DeviceProcessEvents\n| take 100',
      },
      { name: 'idColumn', label: 'Id column (optional)', kind: 'string' },
    ],
  },
  {
    key: 'run_sql',
    name: 'Run SQL',
    menu: 'Snowflake',
    source: 'built-in',
    params: [
      {
        name: 'connection',
        label: 'Connection',
        kind: 'connection',
        required: true,
        choices: ['snowflake-prod'],
        default: 'snowflake-prod',
      },
      {
        name: 'sql',
        label: 'SQL',
        kind: 'sql',
        required: true,
        default: 'SELECT * FROM OKTA.SYSTEM_LOG\nLIMIT 100',
      },
      { name: 'idColumn', label: 'Id column (optional)', kind: 'string' },
    ],
  },
  {
    key: 'signins_for_user',
    name: 'Sign-ins for user',
    menu: 'Identity',
    source: 'action file identity/signins.yaml',
    params: [
      {
        name: 'user',
        label: 'User',
        kind: 'string',
        required: true,
        fromColumns: ['AccountUpn', 'UserPrincipalName', 'Upn'],
      },
      {
        name: 'lookback',
        label: 'Lookback',
        kind: 'choice',
        choices: ['1d', '7d', '30d'],
        default: '7d',
      },
    ],
  },
  {
    key: 'host_processes',
    name: 'Host processes',
    menu: 'Endpoint',
    source: 'package tim-actions-defender',
    params: [
      {
        name: 'host',
        label: 'Hosts',
        kind: 'string',
        required: true,
        fromColumns: ['DeviceName', 'Computer', 'Host'],
        many: true,
      },
      { name: 'start', label: 'Start', kind: 'datetime', default: 'ago(1d)' },
    ],
  },
];
const actionByKey = (k: string) => ACTIONS.find((a) => a.key === k)!;

const COLUMNS = ['Timestamp', 'DeviceName', 'AccountUpn', 'ProcessName', 'SHA256'];
const ROWS: Record<string, string>[] = [
  {
    Timestamp: '2026-10-15T08:01Z',
    DeviceName: 'wks-0141',
    AccountUpn: 'jo@contoso.com',
    ProcessName: 'powershell.exe',
    SHA256: '9f2c…a1',
  },
  {
    Timestamp: '2026-10-15T08:03Z',
    DeviceName: 'wks-0141',
    AccountUpn: 'jo@contoso.com',
    ProcessName: 'rundll32.exe',
    SHA256: '44be…07',
  },
  {
    Timestamp: '2026-10-15T09:12Z',
    DeviceName: 'srv-db-02',
    AccountUpn: 'svc-sql@contoso.com',
    ProcessName: 'sqlservr.exe',
    SHA256: 'c0de…ff',
  },
];

// ---------------------------------------------------------------- saved params model

/**
 * A param that can be fixed or filled from the clicked row: an action param that declares
 * from_columns, or a query parameter of a saved KQL/SQL query (bound server-side, never spliced).
 */
interface Input {
  name: string;
  type: string;
  via: 'param' | 'query';
  /** fixed: `value` is saved. row: filled from `columns` when pivoting, asked in the form otherwise. */
  mode: 'fixed' | 'row';
  /** Fixed: the saved value. From row: the tab's test value (for Run and the preview), never saved. */
  value: string;
  columns: string[];
  many: boolean;
}
interface Saved {
  id: string;
  name: string;
  menu: string;
  actionKey: string;
  /** The action's other params, always fixed (connection, database, query text, ...). */
  values: Record<string, string>;
  inputs: Input[];
  owner: string;
  shared: boolean;
  hiddenBy: string[];
  updated: number;
}

const ME = 'alex@contoso.com';
const SAM = 'sam@contoso.com';

/**
 * Suggests query parameters from the query text. Only a suggestion: the declared inputs are the
 * source of truth, and TIM builds the backend binding from them.
 * KQL: an existing `declare query_parameters(...)`. SQL: `:name` placeholders (not `::` casts or `:1`).
 */
function suggestQueryParams(values: Record<string, string>): { name: string; type: string }[] {
  if (values.kql) {
    const m = /declare\s+query_parameters\s*\(([^)]*)\)/i.exec(values.kql);
    if (!m) return [];
    return m[1]!
      .split(',')
      .map((p) => p.split(':').map((s) => s.trim()))
      .filter(([n, t]) => n && t)
      .map(([n, t]) => ({ name: n!, type: t!.replace(/\s*=.*$/, '') }));
  }
  if (values.sql) {
    const names = [...values.sql.matchAll(/(?<![:\w]):([A-Za-z_]\w*)/g)].map((m) => m[1]!);
    return [...new Set(names)].map((name) => ({ name, type: 'string' }));
  }
  return [];
}
const hasQuery = (a: ActionDef) => a.params.some((p) => p.kind === 'kql' || p.kind === 'sql');

const queryInput = (name: string, type = 'string'): Input => ({
  name,
  type,
  via: 'query',
  mode: 'row',
  value: '',
  // Suggest a same-named result column; otherwise the analyst maps it.
  columns: COLUMNS.includes(name) ? [name] : [],
  many: false,
});

/** Adds inputs for the action's from_columns params and newly typed query parameters; keeps the rest. */
function syncInputs(a: ActionDef, values: Record<string, string>, inputs: Input[]): Input[] {
  const has = (n: string) => inputs.some((i) => i.name === n);
  const params: Input[] = a.params
    .filter((p) => p.fromColumns && !has(p.name))
    .map((p) => ({
      name: p.name,
      type: p.kind,
      via: 'param',
      mode: 'row',
      value: '',
      columns: p.fromColumns!,
      many: !!p.many,
    }));
  const query = suggestQueryParams(values)
    .filter((q) => !has(q.name))
    .map((q) => queryInput(q.name, q.type));
  return [...inputs, ...params, ...query];
}

const openInputs = (inputs: Input[]) => inputs.filter((i) => i.mode === 'row');
/** A pivot when it has open inputs and every one maps to a column. Open inputs without columns are asked in the form. */
const isPivot = (s: Saved) => {
  const open = openInputs(s.inputs);
  return open.length > 0 && open.every((i) => i.columns.length > 0);
};
const pivotMatches = (inputs: Input[], cols: string[]) =>
  openInputs(inputs).every((i) => i.columns.some((c) => cols.includes(c)));
const visibleTo = (s: Saved, who: string) =>
  (s.owner === who || s.shared) && !s.hiddenBy.includes(who);
/** Test values stay on the tab; only fixed values are saved. */
const forSave = (inputs: Input[]) =>
  inputs.map((i) => (i.mode === 'row' ? { ...i, value: '' } : i));
const fromRow = (inputs: Input[], row: Record<string, string>) =>
  inputs.map((i) =>
    i.mode === 'row' ? { ...i, value: row[i.columns.find((c) => c in row) ?? ''] ?? '' } : i,
  );

/** What the hook sends. From-row inputs use the tab's test value, or a placeholder when there is none. */
function backendRequest(s: Saved): string {
  const valueOf = (i: Input): string | string[] => {
    const placeholder = `<${i.columns[0] ?? '?'} of ${i.many ? 'each selected row' : 'the clicked row'}>`;
    if (i.mode === 'row' && !i.value) return i.many ? [placeholder] : placeholder;
    return i.many
      ? i.value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : i.value;
  };
  const qp = s.inputs.filter((i) => i.via === 'query');
  if (s.actionKey === 'run_kql') {
    const kql = s.values.kql ?? '';
    // Fixed query parameters are bound too: the query text never changes.
    const declare = /declare\s+query_parameters/i.test(kql)
      ? ''
      : qp.length
        ? `declare query_parameters(${qp.map((i) => `${i.name}:${i.many ? 'dynamic' : i.type}`).join(', ')});\n`
        : '';
    const params = Object.fromEntries(
      qp.map((i) => {
        const v = valueOf(i);
        return [
          i.name,
          Array.isArray(v)
            ? `dynamic(${JSON.stringify(v)})`
            : i.type === 'string'
              ? v
              : `${i.type}(${v})`,
        ];
      }),
    );
    return `Kusto query (text is never spliced):\n${declare}${kql}\n\nClientRequestProperties.Parameters:\n${JSON.stringify(params, null, 1)}`;
  }
  if (s.actionKey === 'run_sql') {
    // Snowflake binds server-side only by position (qmark / numeric) and not into IN lists,
    // so the hook rewrites :name to :N and a `many` input becomes one JSON array bind.
    const order: string[] = [];
    const sql = (s.values.sql ?? '').replace(/(?<![:\w]):([A-Za-z_]\w*)/g, (_m, n: string) => {
      if (!order.includes(n)) order.push(n);
      const i = qp.find((x) => x.name === n);
      const pos = `:${order.indexOf(n) + 1}`;
      return i?.many ? `(SELECT value FROM TABLE(FLATTEN(INPUT => PARSE_JSON(${pos}))))` : pos;
    });
    const binds = order.map((n) => {
      const i = qp.find((x) => x.name === n);
      if (!i) return `<${n}: not declared, save blocked>`;
      const v = valueOf(i);
      return Array.isArray(v) ? JSON.stringify(JSON.stringify(v)) : JSON.stringify(v);
    });
    return `Snowflake (paramstyle=numeric, server-side):\n${sql}\n\nbinds: [${binds.join(', ')}]`;
  }
  const params = Object.fromEntries(s.inputs.map((i) => [i.name, valueOf(i)]));
  return `Action ${s.actionKey} runs with params:\n${JSON.stringify({ ...s.values, ...params }, null, 1)}`;
}

function toYaml(s: Saved): string {
  const a = actionByKey(s.actionKey);
  const lines = [
    `# Promote "${s.name}" to an action file (an admin adds it to TIM_ACTION_FILES).`,
    `type: ${a.key === 'run_kql' ? 'kql_query' : a.key === 'run_sql' ? 'snowflake_query' : a.key}`,
    `key: ${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    `name: ${s.name}`,
    `menu: ${s.menu || a.menu}`,
  ];
  for (const [k, v] of Object.entries(s.values)) {
    if (k === 'kql' || k === 'sql') lines.push(`${k}: |`, ...v.split('\n').map((l) => `  ${l}`));
    else if (k !== 'idColumn' && v) lines.push(`${k}: ${v}`);
  }
  if (s.inputs.length) {
    lines.push('params:');
    for (const i of s.inputs) {
      lines.push(`  - name: ${i.name}`, `    kind: ${i.type}`);
      if (i.mode === 'row') lines.push(`    from_columns: [${i.columns.join(', ')}]`);
      else lines.push(`    default: ${JSON.stringify(i.value)}`);
      if (i.many) lines.push('    many: true');
    }
  }
  lines.push(s.values.idColumn ? `id: {columns: [${s.values.idColumn}]}` : 'id: hash_values');
  return lines.join('\n');
}

const SEED: Saved[] = [
  {
    id: 's1',
    name: 'Rare parents of process',
    menu: 'Endpoint/Hunting',
    actionKey: 'run_kql',
    values: {
      connection: 'security-prod',
      database: 'SecurityLogs',
      kql: 'DeviceProcessEvents\n| where FileName == ProcessName\n| summarize count() by InitiatingProcessFileName\n| where count_ < MaxCount',
    },
    inputs: [
      { ...queryInput('ProcessName'), columns: ['ProcessName', 'FileName'] },
      { ...queryInput('MaxCount', 'long'), mode: 'fixed', value: '5' },
    ],
    owner: SAM,
    shared: true,
    hiddenBy: [],
    updated: 1,
  },
  {
    id: 's2',
    name: 'Sign-ins, 30 days',
    menu: 'Identity',
    actionKey: 'signins_for_user',
    values: { lookback: '30d' },
    inputs: syncInputs(actionByKey('signins_for_user'), {}, []),
    owner: ME,
    shared: false,
    hiddenBy: [],
    updated: 2,
  },
  {
    id: 's4',
    name: 'Okta events for users',
    menu: 'Identity/Okta',
    actionKey: 'run_sql',
    values: {
      connection: 'snowflake-prod',
      sql: 'SELECT uuid, published, event_type, outcome\nFROM OKTA.SYSTEM_LOG\nWHERE actor_alternate_id IN :users\n  AND published > DATEADD(day, -7, CURRENT_TIMESTAMP())',
      idColumn: 'uuid',
    },
    inputs: [{ ...queryInput('users'), columns: ['AccountUpn', 'UserPrincipalName'], many: true }],
    owner: SAM,
    shared: true,
    hiddenBy: [],
    updated: 4,
  },
  {
    id: 's3',
    name: 'My noisy-alerts baseline',
    menu: '',
    actionKey: 'run_kql',
    values: {
      connection: 'security-dev',
      database: 'Alerts',
      kql: 'AlertInfo\n| summarize count() by Title\n| top 50 by count_',
      idColumn: 'Title',
    },
    inputs: [],
    owner: ME,
    shared: false,
    hiddenBy: [],
    updated: 3,
  },
];

// ---------------------------------------------------------------- tabs

interface Tab {
  id: number;
  actionKey: string;
  /** The action's other params. */
  values: Record<string, string>;
  /** Fixed or from-row inputs, with the tab's values (fixed values or test values). */
  inputs: Input[];
  /** Snapshot origin: later edits to the saved item don't change the tab. */
  fromSaved?: string;
  via: string;
}

const defaults = (a: ActionDef) =>
  Object.fromEntries(a.params.filter((p) => !p.fromColumns).map((p) => [p.name, p.default ?? '']));

// ---------------------------------------------------------------- page

const VARIANTS = [
  { key: 'A', name: 'Save dialog + New menu' },
  { key: 'B', name: 'Pin params in the form' },
  { key: 'C', name: 'Library page' },
] as const;

export function SavedParamsPage() {
  const variant = usePrototypeVariant(VARIANTS.map((v) => v.key));
  const [who, setWho] = useState(ME);
  const [saved, setSaved] = useState<Saved[]>(SEED);
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const a = actionByKey('run_kql');
    return [{ id: 1, actionKey: a.key, values: defaults(a), inputs: [], via: 'New → Run KQL' }];
  });
  const [active, setActive] = useState(1);
  const [log, setLog] = useState<string[]>(['start']);
  const [showLibrary, setShowLibrary] = useState(false);
  const say = (s: string) => setLog((l) => [s, ...l].slice(0, 8));

  const tab = tabs.find((t) => t.id === active) ?? tabs[0]!;
  const mine = saved.filter((s) => s.owner === who);
  const visible = saved.filter((s) => visibleTo(s, who));

  const openTab = (
    actionKey: string,
    via: string,
    origin: { inputs?: Input[]; values?: Record<string, string>; fromSaved?: string } = {},
  ) => {
    const a = actionByKey(actionKey);
    const id = Math.max(0, ...tabs.map((t) => t.id)) + 1;
    const values = { ...defaults(a), ...origin.values };
    const inputs = syncInputs(a, values, origin.inputs ?? []);
    setTabs((ts) => [...ts, { id, actionKey, values, inputs, via, fromSaved: origin.fromSaved }]);
    setActive(id);
    setShowLibrary(false);
    say(`open tab ${id} (${via})`);
  };
  const openSaved = (s: Saved, row?: Record<string, string>) =>
    openTab(s.actionKey, row ? `pivot → ${s.name}` : `New → ${s.name}`, {
      values: s.values,
      inputs: row ? fromRow(s.inputs, row) : s.inputs,
      fromSaved: s.id,
    });
  const updateTab = (patch: { values?: Record<string, string>; inputs?: Input[] }) =>
    setTabs((ts) =>
      ts.map((t) => {
        if (t.id !== tab.id) return t;
        const values = patch.values ?? t.values;
        const inputs = syncInputs(actionByKey(t.actionKey), values, patch.inputs ?? t.inputs);
        return { ...t, values, inputs };
      }),
    );
  const upsert = (s: Saved) => {
    const clean = { ...s, inputs: forSave(s.inputs), updated: Date.now() };
    setSaved((all) =>
      all.some((x) => x.id === s.id)
        ? all.map((x) => (x.id === s.id ? clean : x))
        : [...all, clean],
    );
    say(
      `${saved.some((x) => x.id === s.id) ? 'update' : 'save'} "${s.name}" (${s.shared ? 'shared' : 'private'}${isPivot(s) ? ', pivot' : ''})`,
    );
  };
  const remove = (s: Saved) => {
    setSaved((all) => all.filter((x) => x.id !== s.id));
    say(`delete "${s.name}" (open tabs keep their snapshot)`);
  };
  const hide = (s: Saved) => {
    setSaved((all) =>
      all.map((x) => (x.id === s.id ? { ...x, hiddenBy: [...x.hiddenBy, who] } : x)),
    );
    say(`hide "${s.name}" from ${who}'s menus`);
  };
  const duplicate = (s: Saved) =>
    upsert({
      ...s,
      id: `s${Date.now()}`,
      name: `${s.name} (copy)`,
      owner: who,
      shared: false,
      hiddenBy: [],
    });
  /** The tab as a saved item, test values included (upsert strips them). */
  const fromTab = (): Saved => {
    const a = actionByKey(tab.actionKey);
    const origin = tab.fromSaved ? saved.find((s) => s.id === tab.fromSaved) : undefined;
    const existing = origin?.owner === who ? origin : undefined;
    return {
      id: existing?.id ?? `s${Date.now()}`,
      name:
        existing?.name ??
        (origin ? `${origin.name} (copy)` : hasQuery(a) ? 'Untitled query' : `${a.name} (saved)`),
      menu: existing?.menu ?? origin?.menu ?? a.menu,
      actionKey: a.key,
      values: Object.fromEntries(Object.entries(tab.values).filter(([, v]) => v)),
      inputs: tab.inputs,
      owner: who,
      shared: existing?.shared ?? false,
      hiddenBy: [],
      updated: Date.now(),
    };
  };

  // Right-click on a grid row: admin actions and saved pivots whose inputs match the grid's columns.
  const pivotMenu = () => ({
    actions: ACTIONS.filter(
      (a) => a.params.some((p) => p.fromColumns) && pivotMatches(syncInputs(a, {}, []), COLUMNS),
    ),
    pivots: visible.filter((s) => isPivot(s) && pivotMatches(s.inputs, COLUMNS)),
  });

  const common = {
    who,
    tab,
    saved,
    visible,
    mine,
    openTab,
    openSaved,
    updateTab,
    upsert,
    remove,
    hide,
    duplicate,
    fromTab,
    pivotMenu,
    say,
  };

  return (
    <Box
      sx={{
        display: 'flex',
        height: '100vh',
        bgcolor: 'background.default',
        color: 'text.primary',
      }}
    >
      <Box sx={{ width: 220, borderRight: 1, borderColor: 'divider', p: 1, overflow: 'auto' }}>
        <NewMenu {...common} variant={variant} onLibrary={() => setShowLibrary(true)} />
        <Typography variant="overline">Tabs</Typography>
        {tabs.map((t) => (
          <Box
            key={t.id}
            onClick={() => {
              setActive(t.id);
              setShowLibrary(false);
            }}
            sx={{
              p: 0.5,
              cursor: 'pointer',
              borderRadius: 1,
              bgcolor: t.id === tab.id && !showLibrary ? 'action.selected' : undefined,
            }}
          >
            <Typography variant="body2">
              {t.id}. {actionByKey(t.actionKey).name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t.via}
            </Typography>
          </Box>
        ))}
        {variant === 'B' && <SidePanel {...common} />}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, p: 2, overflow: 'auto' }}>
        {variant === 'C' && showLibrary ? (
          <Library {...common} />
        ) : (
          <TabView key={tab.id} {...common} variant={variant} />
        )}
      </Box>

      <Box
        sx={{
          width: 300,
          borderLeft: 1,
          borderColor: 'divider',
          p: 1,
          overflow: 'auto',
          font: '11px/1.4 monospace',
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <span>Signed in as</span>
          <TextField select size="small" value={who} onChange={(e) => setWho(e.target.value)}>
            <MenuItem value={ME}>{ME}</MenuItem>
            <MenuItem value={SAM}>{SAM}</MenuItem>
          </TextField>
        </Stack>
        <p>
          <b>Log</b>
        </p>
        {log.map((l, i) => (
          <div key={i}>• {l}</div>
        ))}
        <p>
          <b>Active tab inputs</b>
        </p>
        <pre style={{ whiteSpace: 'pre-wrap' }}>
          {tab.inputs
            .map(
              (i) =>
                `${i.name}: ${i.mode === 'fixed' ? `fixed ${JSON.stringify(i.value)}` : `from ${i.columns.join('|') || '(no column)'}, test ${JSON.stringify(i.value)}`}`,
            )
            .join('\n') || '(none)'}
        </pre>
        <p>
          <b>Saved params (server)</b>
        </p>
        <pre style={{ whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(
            saved.map((s) => ({ ...s, updated: undefined, pivot: isPivot(s) })),
            null,
            1,
          )}
        </pre>
      </Box>

      <PrototypeSwitcher
        variants={VARIANTS}
        state={`${visible.length} visible saved, ${mine.length} mine`}
      />
    </Box>
  );
}
export default SavedParamsPage;

type Common = {
  who: string;
  tab: Tab;
  saved: Saved[];
  visible: Saved[];
  mine: Saved[];
  openTab: (
    k: string,
    via: string,
    origin?: { inputs?: Input[]; values?: Record<string, string>; fromSaved?: string },
  ) => void;
  openSaved: (s: Saved, row?: Record<string, string>) => void;
  updateTab: (patch: { values?: Record<string, string>; inputs?: Input[] }) => void;
  upsert: (s: Saved) => void;
  remove: (s: Saved) => void;
  hide: (s: Saved) => void;
  duplicate: (s: Saved) => void;
  fromTab: () => Saved;
  pivotMenu: () => { actions: ActionDef[]; pivots: Saved[] };
  say: (s: string) => void;
};

// ---------------------------------------------------------------- New menu

function NewMenu(p: Common & { variant: string; onLibrary: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  const mySaved = p.visible.filter((s) => s.owner === p.who);
  const shared = p.visible.filter((s) => s.owner !== p.who);
  // A: saved items live in the New menu with inline manage buttons.
  // B and C: the New menu only opens them; managing is in the side panel / library.
  const row = (s: Saved) => (
    <MenuItem
      key={s.id}
      onClick={() => {
        p.openSaved(s);
        close();
      }}
    >
      <Box sx={{ flex: 1 }}>
        {s.name}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {actionByKey(s.actionKey).name}
          {isPivot(s) ? ' · pivot' : ''}
          {s.owner !== p.who ? ` · ${s.owner}` : s.shared ? ' · shared' : ''}
        </Typography>
      </Box>
      {p.variant === 'A' && <ManageButtons {...p} s={s} />}
    </MenuItem>
  );
  return (
    <>
      <Button fullWidth variant="contained" onClick={(e) => setAnchor(e.currentTarget)}>
        New
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        <ListSubheader>Actions</ListSubheader>
        {ACTIONS.map((a) => (
          <MenuItem
            key={a.key}
            onClick={() => {
              p.openTab(a.key, `New → ${a.name}`);
              close();
            }}
          >
            {a.menu} / {a.name}
          </MenuItem>
        ))}
        <ListSubheader>My saved</ListSubheader>
        {mySaved.map(row)}
        <ListSubheader>Shared with everyone</ListSubheader>
        {shared.map(row)}
        {p.variant === 'C' && <Divider />}
        {p.variant === 'C' && (
          <MenuItem
            onClick={() => {
              p.onLibrary();
              close();
            }}
          >
            Open library…
          </MenuItem>
        )}
      </Menu>
      <Box sx={{ mb: 1 }} />
    </>
  );
}

function ManageButtons(p: Common & { s: Saved; onEdit?: () => void }) {
  const [editing, setEditing] = useState(false);
  const stop = (f: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    f();
  };
  const own = p.s.owner === p.who;
  return (
    <Box sx={{ display: 'flex' }} onClick={(e) => e.stopPropagation()}>
      {own ? (
        <>
          <Tooltip title="Edit">
            <IconButton
              size="small"
              onClick={stop(() => (p.onEdit ? p.onEdit() : setEditing(true)))}
            >
              <EditIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" onClick={stop(() => p.remove(p.s))}>
              <DeleteIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        </>
      ) : (
        <Tooltip title="Hide from my menus">
          <IconButton size="small" onClick={stop(() => p.hide(p.s))}>
            <VisibilityOffIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Duplicate as mine">
        <IconButton size="small" onClick={stop(() => p.duplicate(p.s))}>
          <ContentCopyIcon fontSize="inherit" />
        </IconButton>
      </Tooltip>
      {editing && (
        <Dialog open onClose={() => setEditing(false)} maxWidth="md" fullWidth>
          <DialogTitle>Edit saved params</DialogTitle>
          <SaveEditor
            initial={p.s}
            onCancel={() => setEditing(false)}
            onSave={(s) => {
              p.upsert(s);
              setEditing(false);
            }}
          />
        </Dialog>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------- inputs

/** Comma-separated column list. Keeps the raw text so typing ", " isn't eaten mid-edit. */
function ColumnsField({
  columns,
  onChange,
}: {
  columns: string[];
  onChange: (columns: string[]) => void;
}) {
  const [text, setText] = useState(columns.join(', '));
  return (
    <TextField
      size="small"
      label="From columns (first match wins)"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean),
        );
      }}
      error={columns.length === 0}
      helperText={columns.length === 0 ? 'Map a column to offer it as a pivot' : undefined}
      sx={{ flex: 1, minWidth: 220 }}
    />
  );
}

/**
 * One input. `toggle` says how the mode is switched: 'pin' (B, in the form), 'buttons' (A dialog,
 * C library) or 'none' (A and C tabs: the mode is set when saving, the tab only holds the value).
 */
function InputRow({
  input: i,
  label,
  toggle,
  onChange,
  onDelete,
}: {
  input: Input;
  label?: string;
  toggle: 'pin' | 'buttons' | 'none';
  onChange: (i: Input) => void;
  onDelete?: () => void;
}) {
  const row = i.mode === 'row';
  const setMode = (mode: Input['mode']) => onChange({ ...i, mode });
  const valueLabel =
    toggle === 'none'
      ? (label ?? i.name)
      : `${label ?? i.name}${row ? ': test value, not saved' : ': saved value'}`;
  const hint =
    toggle === 'none' && row && i.columns.length
      ? `From ${i.columns.join(' / ')} when pivoting`
      : i.many
        ? 'Comma-separated'
        : undefined;
  return (
    <Stack direction="row" sx={{ gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {i.via === 'query' && (
        <>
          <Chip size="small" color="primary" label={i.name} onDelete={onDelete} sx={{ mt: 1 }} />
          <TextField
            select
            size="small"
            value={i.type}
            onChange={(e) => onChange({ ...i, type: e.target.value })}
            sx={{ width: 110 }}
          >
            {['string', 'long', 'real', 'datetime', 'bool'].map((t) => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextField>
        </>
      )}
      {toggle === 'buttons' && (
        <ToggleButtonGroup
          size="small"
          exclusive
          value={i.mode}
          onChange={(_e, m: Input['mode'] | null) => m && setMode(m)}
        >
          <ToggleButton value="fixed">Fixed</ToggleButton>
          <ToggleButton value="row">From row</ToggleButton>
        </ToggleButtonGroup>
      )}
      <TextField
        size="small"
        label={valueLabel}
        value={i.value}
        onChange={(e) => onChange({ ...i, value: e.target.value })}
        helperText={hint}
        sx={{ flex: 1, minWidth: 200 }}
      />
      {toggle === 'pin' && (
        <Tooltip
          title={row ? 'Unpin: save this value as fixed' : 'Pin: fill from a column when pivoting'}
        >
          <IconButton onClick={() => setMode(row ? 'fixed' : 'row')}>
            {row ? <PushPinIcon /> : <PushPinOutlinedIcon />}
          </IconButton>
        </Tooltip>
      )}
      {row && toggle !== 'none' && (
        <>
          <ColumnsField columns={i.columns} onChange={(columns) => onChange({ ...i, columns })} />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={i.many}
                onChange={(e) => onChange({ ...i, many: e.target.checked })}
              />
            }
            label="All selected rows"
          />
        </>
      )}
    </Stack>
  );
}

function AddParameter({ taken, onAdd }: { taken: string[]; onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <Stack direction="row" sx={{ gap: 1 }}>
      <TextField
        size="small"
        placeholder="Parameter name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button
        disabled={!/^[A-Za-z_]\w*$/.test(name) || taken.includes(name)}
        onClick={() => {
          onAdd(name);
          setName('');
        }}
      >
        Add parameter
      </Button>
    </Stack>
  );
}

/** Query parameters of a KQL/SQL action, in the tab (all variants) and in the save editor. */
function QueryParams({
  a,
  inputs,
  toggle,
  onChange,
}: {
  a: ActionDef;
  inputs: Input[];
  toggle: 'pin' | 'buttons' | 'none';
  onChange: (inputs: Input[]) => void;
}) {
  const qp = inputs.filter((i) => i.via === 'query');
  const set = (n: string, next: Input) => onChange(inputs.map((i) => (i.name === n ? next : i)));
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}>
      <Typography variant="subtitle2">
        Query parameters (bound server-side, never spliced)
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
        {a.key === 'run_sql'
          ? 'Write :name in the SQL; it is picked up here.'
          : 'Reference a parameter by name in the KQL and add it here; TIM adds the declare statement.'}
        {toggle === 'none' ? ' Choose fixed or from-row when saving.' : ''}
      </Typography>
      <Stack sx={{ gap: 1 }}>
        {qp.map((i) => (
          <InputRow
            key={i.name}
            input={i}
            toggle={toggle}
            onChange={(next) => set(i.name, next)}
            onDelete={() => onChange(inputs.filter((x) => x.name !== i.name))}
          />
        ))}
        <AddParameter
          taken={inputs.map((i) => i.name)}
          onAdd={(name) => onChange([...inputs, queryInput(name)])}
        />
      </Stack>
    </Box>
  );
}

// ---------------------------------------------------------------- tab

function TabView(p: Common & { variant: string }) {
  const a = actionByKey(p.tab.actionKey);
  const [saving, setSaving] = useState<Saved | null>(null);
  const [quickName, setQuickName] = useState('');
  const [quickShared, setQuickShared] = useState(false);
  const origin = p.tab.fromSaved ? p.saved.find((s) => s.id === p.tab.fromSaved) : undefined;
  const toggle = p.variant === 'B' ? 'pin' : 'none';
  const setInputs = (inputs: Input[]) => p.updateTab({ inputs });

  const field = (param: ParamDef) => {
    const input = p.tab.inputs.find((i) => i.name === param.name);
    if (input)
      return (
        <InputRow
          key={param.name}
          input={input}
          label={param.label}
          toggle={toggle}
          onChange={(next) =>
            setInputs(p.tab.inputs.map((i) => (i.name === param.name ? next : i)))
          }
        />
      );
    const set = (v: string) => p.updateTab({ values: { ...p.tab.values, [param.name]: v } });
    const code = param.kind === 'kql' || param.kind === 'sql';
    return param.kind === 'choice' || param.kind === 'connection' ? (
      <TextField
        key={param.name}
        select
        size="small"
        fullWidth
        label={param.label}
        value={p.tab.values[param.name] ?? ''}
        onChange={(e) => set(e.target.value)}
      >
        {param.choices!.map((c) => (
          <MenuItem key={c} value={c}>
            {c}
          </MenuItem>
        ))}
      </TextField>
    ) : (
      <TextField
        key={param.name}
        size="small"
        fullWidth
        multiline={code}
        minRows={code ? 5 : undefined}
        label={param.label}
        value={p.tab.values[param.name] ?? ''}
        onChange={(e) => set(e.target.value)}
        slotProps={{ htmlInput: { style: code ? { fontFamily: 'monospace' } : undefined } }}
      />
    );
  };

  return (
    <Stack sx={{ gap: 1.5, maxWidth: 1000 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          {a.name}{' '}
          <Typography component="span" variant="caption" color="text.secondary">
            ({a.source}){origin ? ` · from saved "${origin.name}" (snapshot)` : ''}
          </Typography>
        </Typography>
        {p.variant === 'A' && (
          <Button startIcon={<StarBorderIcon />} onClick={() => setSaving(p.fromTab())}>
            {origin?.owner === p.who ? 'Save' : 'Save as…'}
          </Button>
        )}
        {p.variant === 'C' && (
          <Button
            startIcon={<StarBorderIcon />}
            onClick={() => {
              p.upsert(p.fromTab());
              p.say('saved privately; name, sharing and fixed/from-row are edited in the library');
            }}
          >
            Save to library
          </Button>
        )}
        <Button
          variant="outlined"
          onClick={() =>
            p.say(
              `run tab with ${p.tab.inputs.map((i) => `${i.name}=${JSON.stringify(i.value)}`).join(', ') || 'no inputs'}`,
            )
          }
        >
          Run
        </Button>
      </Stack>

      {a.params.map(field)}

      {hasQuery(a) && (
        <QueryParams a={a} inputs={p.tab.inputs} toggle={toggle} onChange={setInputs} />
      )}

      {p.variant === 'B' && (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <TextField
            size="small"
            label="Save as"
            placeholder="Name"
            value={quickName}
            onChange={(e) => setQuickName(e.target.value)}
          />
          <FormControlLabel
            control={
              <Switch checked={quickShared} onChange={(e) => setQuickShared(e.target.checked)} />
            }
            label="Share with everyone"
          />
          <Button
            startIcon={<StarBorderIcon />}
            onClick={() => {
              const base = p.fromTab();
              p.upsert({ ...base, name: quickName || base.name, shared: quickShared });
            }}
          >
            Save
          </Button>
        </Stack>
      )}

      <MockGrid {...p} />

      {saving && (
        <Dialog open onClose={() => setSaving(null)} maxWidth="lg" fullWidth>
          <DialogTitle>Save params</DialogTitle>
          <SaveEditor
            initial={saving}
            onCancel={() => setSaving(null)}
            onSave={(s) => {
              p.upsert(s);
              setSaving(null);
            }}
          />
        </Dialog>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------- save editor (A dialog, C library pane)

function SaveEditor({
  initial,
  onSave,
  onCancel,
  inline,
}: {
  initial: Saved;
  onSave: (s: Saved) => void;
  onCancel?: () => void;
  inline?: boolean;
}) {
  const [s, setS] = useState(initial);
  const a = actionByKey(s.actionKey);
  const setInputs = (inputs: Input[]) => setS({ ...s, inputs });
  const open = openInputs(s.inputs);
  const body = (
    <Stack sx={{ gap: 2, pt: 1 }}>
      <Stack direction="row" sx={{ gap: 1 }}>
        <TextField
          size="small"
          label="Name"
          value={s.name}
          onChange={(e) => setS({ ...s, name: e.target.value })}
          sx={{ flex: 1 }}
        />
        <TextField
          size="small"
          label="Menu folder"
          value={s.menu}
          onChange={(e) => setS({ ...s, menu: e.target.value })}
        />
      </Stack>
      <RadioGroup
        row
        value={s.shared ? 'all' : 'me'}
        onChange={(e) => setS({ ...s, shared: e.target.value === 'all' })}
      >
        <FormControlLabel value="me" control={<Radio size="small" />} label="Only me" />
        <FormControlLabel
          value="all"
          control={<Radio size="small" />}
          label="Everyone (read-only for others; they can duplicate or hide it)"
        />
      </RadioGroup>
      <Box>
        <Typography variant="subtitle2">Other params of {a.name} (always fixed)</Typography>
        <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {Object.entries(s.values)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n')}
        </pre>
      </Box>
      <Stack sx={{ gap: 1 }}>
        <Typography variant="subtitle2">
          Inputs:{' '}
          {isPivot(s)
            ? 'in the New menu and the right-click menu on rows with a mapped column'
            : open.length
              ? 'New menu only; the form asks for the from-row inputs. Map each to a column to also offer it on right-click'
              : 'all fixed, so New menu only (a bookmark)'}
        </Typography>
        {s.inputs
          .filter((i) => i.via === 'param')
          .map((i) => (
            <InputRow
              key={i.name}
              input={i}
              label={a.params.find((x) => x.name === i.name)?.label}
              toggle="buttons"
              onChange={(next) => setInputs(s.inputs.map((x) => (x.name === i.name ? next : x)))}
            />
          ))}
        {hasQuery(a) && (
          <QueryParams a={a} inputs={s.inputs} toggle="buttons" onChange={setInputs} />
        )}
      </Stack>
      <Box>
        <Typography variant="subtitle2">
          What the backend receives (from-row inputs show the test value, or a placeholder for the
          clicked row)
        </Typography>
        <pre
          style={{
            margin: 0,
            fontSize: 12,
            padding: 8,
            whiteSpace: 'pre-wrap',
            background: 'rgba(127,127,127,.12)',
          }}
        >
          {backendRequest(s)}
        </pre>
      </Box>
    </Stack>
  );
  const actions = (
    <>
      {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      <Button variant="contained" onClick={() => onSave(s)}>
        Save
      </Button>
    </>
  );
  return inline ? (
    <Box>
      {body}
      <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end', mt: 2 }}>
        {actions}
      </Stack>
    </Box>
  ) : (
    <>
      <DialogContent>{body}</DialogContent>
      <DialogActions>{actions}</DialogActions>
    </>
  );
}

// ---------------------------------------------------------------- B: side panel

function SidePanel(p: Common) {
  const [editing, setEditing] = useState<Saved | null>(null);
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="overline">Saved</Typography>
      {p.visible.map((s) => (
        <Box key={s.id} sx={{ py: 0.5, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="body2" sx={{ cursor: 'pointer' }} onClick={() => p.openSaved(s)}>
            {s.name}
          </Typography>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            {isPivot(s) && <Chip size="small" label="pivot" />}
            {s.owner === p.who ? (
              <Chip
                size="small"
                variant={s.shared ? 'filled' : 'outlined'}
                label={s.shared ? 'shared' : 'private'}
                onClick={() => p.upsert({ ...s, shared: !s.shared })}
              />
            ) : (
              <Chip size="small" variant="outlined" label={s.owner.split('@')[0]} />
            )}
            <ManageButtons {...p} s={s} onEdit={() => setEditing(s)} />
          </Stack>
        </Box>
      ))}
      {editing && (
        <Dialog open onClose={() => setEditing(null)} maxWidth="lg" fullWidth>
          <DialogTitle>Edit saved params</DialogTitle>
          <SaveEditor
            initial={editing}
            onCancel={() => setEditing(null)}
            onSave={(s) => {
              p.upsert(s);
              setEditing(null);
            }}
          />
        </Dialog>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------- C: library page

function Library(p: Common) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [yaml, setYaml] = useState<string | null>(null);
  const list = useMemo(
    () => p.visible.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())),
    [p.visible, q],
  );
  const current = p.saved.find((s) => s.id === sel);
  return (
    <Stack direction="row" sx={{ gap: 2, height: '100%' }}>
      <Box sx={{ width: 420 }}>
        <Typography variant="h6">Saved params library</Typography>
        <TextField
          size="small"
          fullWidth
          placeholder="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ my: 1 }}
        />
        <Box
          component="table"
          sx={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            '& td, & th': { borderBottom: 1, borderColor: 'divider', p: 0.5, textAlign: 'left' },
          }}
        >
          <thead>
            <tr>
              <th>Name</th>
              <th>Action</th>
              <th>Owner</th>
              <th>Pivot on</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <Box
                component="tr"
                key={s.id}
                onClick={() => {
                  setSel(s.id);
                  setYaml(null);
                }}
                sx={{ cursor: 'pointer', bgcolor: s.id === sel ? 'action.selected' : undefined }}
              >
                <td>
                  {s.name} {s.shared && <Chip size="small" label="shared" />}
                </td>
                <td>{actionByKey(s.actionKey).name}</td>
                <td>{s.owner === p.who ? 'me' : s.owner.split('@')[0]}</td>
                <td>
                  {isPivot(s)
                    ? openInputs(s.inputs)
                        .map((i) => i.columns[0])
                        .join(', ')
                    : '—'}
                </td>
              </Box>
            ))}
          </tbody>
        </Box>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {current ? (
          <>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              <Typography variant="h6" sx={{ flex: 1 }}>
                {current.name}
              </Typography>
              <Button onClick={() => p.openSaved(current)}>Open</Button>
              <ManageButtons {...p} s={current} onEdit={() => undefined} />
              <Button startIcon={<ContentCopyIcon />} onClick={() => setYaml(toYaml(current))}>
                Copy as action file
              </Button>
            </Stack>
            {yaml && (
              <pre
                style={{
                  fontSize: 12,
                  padding: 8,
                  background: 'rgba(127,127,127,.12)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {yaml}
              </pre>
            )}
            {current.owner === p.who ? (
              <SaveEditor
                key={current.id + current.updated}
                initial={current}
                onSave={p.upsert}
                inline
              />
            ) : (
              <Typography color="text.secondary">
                Owned by {current.owner}: read-only. Duplicate to change it.
              </Typography>
            )}
          </>
        ) : (
          <Typography color="text.secondary">Select a saved item.</Typography>
        )}
      </Box>
    </Stack>
  );
}

// ---------------------------------------------------------------- grid with pivot menu

function MockGrid(p: Common) {
  const [menu, setMenu] = useState<{ x: number; y: number; row: Record<string, string> } | null>(
    null,
  );
  const m = menu ? p.pivotMenu() : null;
  const item = (label: ReactNode, onClick: () => void, key: string) => (
    <MenuItem
      key={key}
      onClick={() => {
        onClick();
        setMenu(null);
      }}
    >
      {label}
    </MenuItem>
  );
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        Results (mock). Right-click a row to pivot.
      </Typography>
      <Box
        component="table"
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
          '& td, & th': { border: 1, borderColor: 'divider', p: 0.5 },
        }}
      >
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r, i) => (
            <tr
              key={i}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, row: r });
              }}
            >
              {COLUMNS.map((c) => (
                <td key={c}>{r[c]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </Box>
      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
      >
        <ListSubheader>Actions</ListSubheader>
        {m?.actions.map((a) =>
          item(
            `${a.menu} / ${a.name}`,
            () =>
              p.openTab(a.key, `pivot → ${a.name}`, {
                inputs: fromRow(syncInputs(a, {}, []), menu!.row),
              }),
            a.key,
          ),
        )}
        <ListSubheader>Saved pivots</ListSubheader>
        {m?.pivots.length === 0 && <MenuItem disabled>None match these columns</MenuItem>}
        {m?.pivots.map((s) =>
          item(
            <span>
              {s.menu ? `${s.menu} / ` : ''}
              {s.name}
              <Typography component="span" variant="caption" color="text.secondary">
                {s.owner !== p.who ? `  · ${s.owner.split('@')[0]}` : ''}
              </Typography>
            </span>,
            () => p.openSaved(s, menu!.row),
            s.id,
          ),
        )}
      </Menu>
    </Box>
  );
}
