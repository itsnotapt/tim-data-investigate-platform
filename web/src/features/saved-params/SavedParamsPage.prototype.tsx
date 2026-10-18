// PROTOTYPE (wayfinder "Saved params"): throwaway, in-memory only, never merged.
// Question: how do analysts create, share and manage saved params, including saved
// queries that become pivots? Actions are admin-authored; saved params are analyst data.
// Every input (an action param with from_columns, or a query parameter) is either Fixed (its
// value is saved) or From row (filled from the selected rows when pivoting). A `dynamic` input is
// an array, sent as JSON; the query parses it (no query rewriting beyond Snowflake's :name to :N).
// Run with `npm run prototype:saved-params`; ◀ ▶ (or arrow keys) switch variants.
import { Fragment, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Collapse,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import SearchIcon from '@mui/icons-material/Search';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined';
import { PrototypeSwitcher, usePrototypeVariant } from '../../components/PrototypeSwitcher';
import { buildTemplateMenuTree, type MenuNode } from '../new-query/templateMenuTree';
import type { QueryTemplate } from '../new-query/types';

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
  {
    Timestamp: '2026-10-15T09:40Z',
    DeviceName: 'wks-0207',
    AccountUpn: 'priya@contoso.com',
    ProcessName: 'powershell.exe',
    SHA256: '9f2c…a1',
  },
  {
    Timestamp: '2026-10-15T10:05Z',
    DeviceName: 'srv-db-02',
    AccountUpn: 'jo@contoso.com',
    ProcessName: 'cmd.exe',
    SHA256: '7a10…3c',
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
  /** The tab's value (what Run uses); saved only when fixed. A `dynamic` value is a JSON array. */
  value: string;
  columns: string[];
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
});

/** Adds inputs for the action's from_columns params and newly typed query parameters; keeps the rest. */
function syncInputs(a: ActionDef, values: Record<string, string>, inputs: Input[]): Input[] {
  const has = (n: string) => inputs.some((i) => i.name === n);
  const params: Input[] = a.params
    .filter((p) => p.fromColumns && !has(p.name))
    .map((p) => ({
      name: p.name,
      type: p.many ? 'dynamic' : p.kind,
      via: 'param',
      mode: 'row',
      value: '',
      columns: p.fromColumns!,
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
const isArray = (i: Input) => i.type === 'dynamic';
const TYPES = ['string', 'long', 'real', 'datetime', 'bool', 'dynamic'];
/** Shown in empty value fields; the preview shows `<column of the clicked row>` instead. */
const PLACEHOLDER: Record<string, string> = {
  string: 'text',
  long: '0',
  real: '0.0',
  datetime: '2026-10-17T00:00:00Z',
  bool: 'true',
  dynamic: 'add values',
};
const parseArray = (v: string): string[] => {
  try {
    const a: unknown = JSON.parse(v || '[]');
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
};
const rowValues = (i: Input, rows: Record<string, string>[]) => [
  ...new Set(rows.map((r) => r[i.columns.find((c) => c in r) ?? ''] ?? '').filter((v) => v !== '')),
];
/** Fills from-row inputs from the selected rows: an array input takes every distinct value. */
const fromRows = (inputs: Input[], rows: Record<string, string>[]) =>
  inputs.map((i) => {
    if (i.mode !== 'row') return i;
    const vs = rowValues(i, rows);
    return { ...i, value: isArray(i) ? JSON.stringify(vs) : (vs[0] ?? '') };
  });
/** Why the pivot can't take these rows: a single-value input sees more than one value. */
const rowsProblem = (inputs: Input[], rows: Record<string, string>[]) => {
  const i = openInputs(inputs).find((x) => !isArray(x) && rowValues(x, rows).length > 1);
  return i ? `${i.name} takes one value; rows have ${rowValues(i, rows).length}` : undefined;
};

/** What the hook sends. From-row inputs show a placeholder for the row's value. */
function backendRequest(s: Saved): string {
  const valueOf = (i: Input): string => {
    if (i.mode === 'fixed') return i.value;
    const col = i.columns[0] ?? '?';
    return isArray(i) ? `["<${col} of each selected row>", …]` : `<${col} of the clicked row>`;
  };
  const qp = s.inputs.filter((i) => i.via === 'query');
  if (s.actionKey === 'run_kql') {
    const kql = s.values.kql ?? '';
    // Fixed query parameters are bound too: the query text never changes.
    const declare = /declare\s+query_parameters/i.test(kql)
      ? ''
      : qp.length
        ? `declare query_parameters(${qp.map((i) => `${i.name}:${i.type}`).join(', ')});\n`
        : '';
    const params = Object.fromEntries(
      qp.map((i) => [i.name, i.type === 'string' ? valueOf(i) : `${i.type}(${valueOf(i)})`]),
    );
    return `Kusto query (text is never spliced):\n${declare}${kql}\n\nClientRequestProperties.Parameters:\n${JSON.stringify(params, null, 1)}`;
  }
  if (s.actionKey === 'run_sql') {
    // Snowflake binds server-side only by position, so the hook renames :name to :N and nothing
    // else. A dynamic input is bound as its JSON text; the query parses it (PARSE_JSON).
    const order: string[] = [];
    const sql = (s.values.sql ?? '').replace(/(?<![:\w]):([A-Za-z_]\w*)/g, (_m, n: string) => {
      if (!order.includes(n)) order.push(n);
      return `:${order.indexOf(n) + 1}`;
    });
    const binds = order.map((n) => {
      const i = qp.find((x) => x.name === n);
      return i ? JSON.stringify(valueOf(i)) : `<${n}: not declared, save blocked>`;
    });
    return `Snowflake (paramstyle=numeric, server-side):\n${sql}\n\nbinds: [${binds.join(', ')}]`;
  }
  const params = Object.fromEntries(
    s.inputs.map((i) => [
      i.name,
      isArray(i) && i.mode === 'fixed' ? parseArray(i.value) : valueOf(i),
    ]),
  );
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
    }
  }
  lines.push(s.values.idColumn ? `id: {columns: [${s.values.idColumn}]}` : 'id: hash_values');
  return lines.join('\n');
}

const SEED: Saved[] = [
  {
    id: 's5',
    name: 'Processes on hosts',
    menu: 'Endpoint/Triage',
    actionKey: 'run_kql',
    values: {
      connection: 'security-prod',
      database: 'SecurityLogs',
      kql: 'DeviceProcessEvents\n| where DeviceName in (Hosts)\n| project Timestamp, DeviceName, FileName, ProcessCommandLine',
    },
    inputs: [{ ...queryInput('Hosts', 'dynamic'), columns: ['DeviceName'] }],
    owner: ME,
    shared: true,
    hiddenBy: [],
    updated: 5,
  },
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
      sql: 'SELECT uuid, published, event_type, outcome\nFROM OKTA.SYSTEM_LOG\nWHERE actor_alternate_id IN (\n    SELECT value::string FROM TABLE(FLATTEN(PARSE_JSON(:users))))\n  AND published > DATEADD(day, -7, CURRENT_TIMESTAMP())',
      idColumn: 'uuid',
    },
    inputs: [{ ...queryInput('users', 'dynamic'), columns: ['AccountUpn', 'UserPrincipalName'] }],
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

// A at scale: about 60 saved items in three-level folders, from several analysts.
const JO = 'jo@contoso.com';
const PRIYA = 'priya@contoso.com';
const BULK: [string, string[]][] = [
  [
    'Endpoint/Hunting/Persistence',
    [
      'Run keys added',
      'Scheduled tasks created',
      'New services',
      'WMI subscriptions',
      'Startup folder writes',
    ],
  ],
  [
    'Endpoint/Hunting/Lateral movement',
    ['PsExec use', 'Remote WMI', 'RDP from workstations', 'SMB admin shares'],
  ],
  ['Endpoint/Hunting/Credential access', ['LSASS access', 'DCSync attempts', 'Kerberoasting']],
  ['Endpoint/Hunting/Defense evasion', ['Defender exclusions', 'Log clearing', 'Unsigned drivers']],
  ['Endpoint/Triage', ['Process tree', 'Network connections', 'File writes', 'Logons on host']],
  [
    'Identity/Entra/Sign-ins',
    ['Failed sign-ins', 'Impossible travel', 'Legacy auth', 'MFA denied', 'New countries'],
  ],
  ['Identity/Entra/Audit', ['Role assignments', 'App consent grants', 'Password resets']],
  ['Identity/Okta/System log', ['Session starts', 'MFA resets', 'Admin role changes']],
  ['Identity/On-prem AD', ['Group changes', 'Account lockouts', 'Kerberos TGS requests']],
  ['Network/Firewall/Palo Alto', ['Denied by host', 'Top talkers', 'Threat logs']],
  ['Network/DNS', ['Rare domains', 'Long subdomains', 'DGA-like lookups']],
  ['Network/Proxy', ['Uploads over 10 MB', 'Newly seen domains']],
  ['Cloud/AWS/CloudTrail', ['Console logins', 'IAM changes', 'S3 bucket policy changes']],
  ['Cloud/Azure/Activity', ['Resource deletions', 'Key Vault access']],
  ['Email/Defender', ['Messages from sender', 'Clicked URLs', 'Quarantine releases']],
  ['Hash', ['Hash prevalence', 'Known-bad hash list']],
  [
    'Scratch',
    ['tmp ransomware sweep', 'tmp vpn check', 'tmp jira 4411', 'tmp ad export', 'tmp test'],
  ],
];
const BULK_PIVOT: [string, string, string][] = [
  // folder prefix, column, parameter
  ['Endpoint', 'DeviceName', 'Host'],
  ['Identity', 'AccountUpn', 'User'],
  ['Network', 'DeviceName', 'Host'],
  ['Cloud', 'AccountUpn', 'User'],
  ['Email', 'AccountUpn', 'Recipient'],
  ['Hash', 'SHA256', 'Sha256'],
  ['Scratch', 'DeviceName', 'Host'],
];
const SNOWFLAKE = ['Identity/Okta', 'Cloud/AWS', 'Network/Proxy'];
let n = 0;
for (const [menu, names] of BULK)
  for (const name of names) {
    n += 1;
    const [, column, param] = BULK_PIVOT.find(([f]) => menu.startsWith(f))!;
    const sql = SNOWFLAKE.some((f) => menu.startsWith(f));
    const table = name.replace(/[^A-Za-z]/g, '');
    // Every fifth is a bookmark (all fixed); the rest pivot on the folder's column.
    const bookmark = n % 5 === 0;
    const owner = menu === 'Scratch' ? ME : [SAM, ME, JO, PRIYA][n % 4]!;
    SEED.push({
      id: `b${n}`,
      name,
      menu,
      actionKey: sql ? 'run_sql' : 'run_kql',
      values: sql
        ? {
            connection: 'snowflake-prod',
            sql: `SELECT * FROM ${table.toUpperCase()}\nWHERE ${column} = :${param.toLowerCase()}`,
            idColumn: '',
          }
        : {
            connection: 'security-prod',
            database: 'SecurityLogs',
            kql: `${table}\n| where ${column} == ${param}`,
            idColumn: '',
          },
      inputs: [
        {
          ...queryInput(sql ? param.toLowerCase() : param),
          columns: [column],
          ...(bookmark ? { mode: 'fixed' as const, value: 'example' } : {}),
        },
      ],
      owner,
      shared: menu !== 'Scratch' && n % 7 !== 0,
      hiddenBy: n % 11 === 0 ? [ME] : [],
      updated: 10 + n,
    });
  }

// ---------------------------------------------------------------- tabs

interface Tab {
  id: number;
  actionKey: string;
  /** The action's other params. */
  values: Record<string, string>;
  /** Fixed or from-row inputs, with the values the tab runs with. */
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
  { key: 'C', name: 'A + library page' },
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
  const openSaved = (s: Saved, rows?: Record<string, string>[]) =>
    openTab(s.actionKey, rows ? `pivot (${rows.length} rows) → ${s.name}` : `New → ${s.name}`, {
      values: s.values,
      inputs: rows ? fromRows(s.inputs, rows) : s.inputs,
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
  const unhide = (s: Saved) => {
    setSaved((all) =>
      all.map((x) => (x.id === s.id ? { ...x, hiddenBy: x.hiddenBy.filter((h) => h !== who) } : x)),
    );
    say(`unhide "${s.name}" for ${who}`);
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
  /** The tab as a new saved item; the save dialog offers to update the item it came from instead. */
  const fromTab = (): Saved => {
    const a = actionByKey(tab.actionKey);
    const origin = tab.fromSaved ? saved.find((s) => s.id === tab.fromSaved) : undefined;
    return {
      id: `s${Date.now()}`,
      name: origin?.name ?? (hasQuery(a) ? 'Untitled query' : `${a.name} (saved)`),
      menu: origin?.menu ?? a.menu,
      actionKey: a.key,
      values: Object.fromEntries(Object.entries(tab.values).filter(([, v]) => v)),
      inputs: tab.inputs,
      owner: who,
      shared: origin?.owner === who ? origin.shared : false,
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
    unhide,
    duplicate,
    fromTab,
    pivotMenu,
    say,
    variant,
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
        <NewMenuTree
          {...common}
          onLibrary={variant === 'C' ? () => setShowLibrary(true) : undefined}
        />
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
                `${i.name} (${i.type}) = ${JSON.stringify(i.value)}; saves as ${i.mode === 'fixed' ? 'fixed' : `from ${i.columns.join(' | ') || '(no column)'}`}`,
            )
            .join('\n') || '(none)'}
        </pre>
        <p>
          <b>Saved params (server), last 3 changed of {saved.length}</b>
        </p>
        <pre style={{ whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(
            [...saved]
              .sort((a, b) => b.updated - a.updated)
              .slice(0, 3)
              .map((s) => ({ ...s, updated: undefined, pivot: isPivot(s) })),
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
  openSaved: (s: Saved, rows?: Record<string, string>[]) => void;
  updateTab: (patch: { values?: Record<string, string>; inputs?: Input[] }) => void;
  upsert: (s: Saved) => void;
  remove: (s: Saved) => void;
  hide: (s: Saved) => void;
  unhide: (s: Saved) => void;
  duplicate: (s: Saved) => void;
  fromTab: () => Saved;
  pivotMenu: () => { actions: ActionDef[]; pivots: Saved[] };
  say: (s: string) => void;
  variant: string;
};

// ---------------------------------------------------------------- A at scale: nested New menu

/** Saved items as templates, so the real New menu's tree builder (full-path folders, search) lays them out. */
const asTemplate = (s: Saved): QueryTemplate =>
  ({
    uuid: s.id,
    queryType: 'query',
    menu: s.name,
    summary: [actionByKey(s.actionKey).name, isPivot(s) ? 'pivot' : '', s.owner, s.menu].join(' '),
    path: s.menu.split('/').filter(Boolean),
  }) as unknown as QueryTemplate;
const actionTemplate = (a: ActionDef): QueryTemplate =>
  ({
    uuid: a.key,
    queryType: 'query',
    menu: a.name,
    summary: a.source,
    path: a.menu.split('/').filter(Boolean),
  }) as unknown as QueryTemplate;
const savedTree = (items: Saved[], search: string) =>
  buildTemplateMenuTree(items.map(asTemplate), { queryType: 'query', search });
const countItems = (nodes: MenuNode[]): number =>
  nodes.reduce((n, x) => n + (x.kind === 'item' ? 1 : countItems(x.children)), 0);

function Folder({
  title,
  count,
  depth,
  forceOpen,
  children,
}: {
  title: string;
  count: number;
  depth: number;
  forceOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const expanded = forceOpen || open;
  return (
    <>
      <ListItemButton
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expanded}
        sx={{ pl: 2 + depth * 2 }}
      >
        <ListItemText primary={title} />
        <Typography variant="caption" color="text.secondary" sx={{ mx: 1 }}>
          {count}
        </Typography>
        {expanded ? <ExpandLess /> : <ExpandMore />}
      </ListItemButton>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <List disablePadding dense>
          {children}
        </List>
      </Collapse>
    </>
  );
}

function TreeNodes({
  nodes,
  depth,
  forceOpen,
  renderItem,
}: {
  nodes: MenuNode[];
  depth: number;
  forceOpen: boolean;
  renderItem: (id: string, depth: number) => ReactNode;
}) {
  return (
    <>
      {nodes.map((n) =>
        n.kind === 'folder' ? (
          <Folder
            key={`f:${n.key}`}
            title={n.title}
            count={countItems(n.children)}
            depth={depth}
            forceOpen={forceOpen}
          >
            <TreeNodes
              nodes={n.children}
              depth={depth + 1}
              forceOpen={forceOpen}
              renderItem={renderItem}
            />
          </Folder>
        ) : (
          <Fragment key={`i:${n.key}`}>{renderItem(n.key, depth)}</Fragment>
        ),
      )}
    </>
  );
}

function savedCaption(s: Saved, who: string) {
  const cols = [...new Set(openInputs(s.inputs).flatMap((i) => i.columns))];
  return [
    actionByKey(s.actionKey).name,
    isPivot(s)
      ? `pivot on ${cols.join(', ')}${openInputs(s.inputs).some(isArray) ? ' (many rows)' : ''}`
      : openInputs(s.inputs).length
        ? 'asks'
        : 'bookmark',
    s.owner !== who ? s.owner.split('@')[0] : s.shared ? 'shared' : 'private',
  ].join(' · ');
}

function SavedItemRow({
  s,
  who,
  depth,
  problem,
  onOpen,
  onMore,
}: {
  s: Saved;
  who: string;
  depth: number;
  /** Set when the selected rows don't fit this pivot; the row is disabled and says why. */
  problem?: string;
  onOpen: () => void;
  onMore?: (el: HTMLElement) => void;
}) {
  return (
    <ListItemButton sx={{ pl: 2 + depth * 2, py: 0 }} onClick={onOpen} disabled={!!problem}>
      <ListItemText primary={s.name} secondary={problem ?? savedCaption(s, who)} />
      {onMore && (
        <IconButton
          size="small"
          aria-label={`More for ${s.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onMore(e.currentTarget);
          }}
        >
          <MoreHorizIcon fontSize="small" />
        </IconButton>
      )}
    </ListItemButton>
  );
}

function MenuSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <li style={{ padding: '4px 16px' }}>
      <TextField
        size="small"
        fullWidth
        autoFocus
        placeholder="Search name, folder, action, owner"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Keep MUI Menu type-ahead from stealing keystrokes, but let Escape close the menu.
        onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}
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
    </li>
  );
}

type Filter = 'all' | 'mine' | 'others' | 'hidden';

/** A: the real New menu's tree (folders by full path, search opens every folder) with one ⋯ per item. */
function NewMenuTree(p: Common & { onLibrary?: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [more, setMore] = useState<{ el: HTMLElement; s: Saved } | null>(null);
  const [editing, setEditing] = useState<Saved | null>(null);
  const [yaml, setYaml] = useState<string | null>(null);
  const close = () => setAnchor(null);
  const searching = search.trim() !== '';
  const items = p.saved.filter((s) => {
    if (filter === 'hidden') return s.hiddenBy.includes(p.who);
    if (!visibleTo(s, p.who)) return false;
    return filter === 'all' || (filter === 'mine') === (s.owner === p.who);
  });
  const byId = new Map(p.saved.map((s) => [s.id, s]));
  const nodes = savedTree(items, search);
  const actions = buildTemplateMenuTree(ACTIONS.map(actionTemplate), {
    queryType: 'query',
    search,
  });
  const m = more?.s;
  const own = m?.owner === p.who;
  const act =
    (f: () => void, closeAll = false) =>
    () => {
      f();
      setMore(null);
      if (closeAll) close();
    };
  return (
    <>
      <Button fullWidth variant="contained" onClick={(e) => setAnchor(e.currentTarget)}>
        New
      </Button>
      <Box sx={{ mb: 1 }} />
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={close}
        autoFocus={false}
        slotProps={{ paper: { sx: { width: 440, maxHeight: '85vh' } } }}
      >
        <MenuSearch value={search} onChange={setSearch} />
        <li style={{ padding: '0 16px 4px' }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={filter}
            onChange={(_, v: Filter | null) => v && setFilter(v)}
          >
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="mine">Mine</ToggleButton>
            <ToggleButton value="others">Others'</ToggleButton>
            <ToggleButton value="hidden">Hidden</ToggleButton>
          </ToggleButtonGroup>
        </li>
        {filter === 'all' && actions.length > 0 && (
          <li>
            <List disablePadding dense>
              <Folder title="Actions" count={countItems(actions)} depth={0} forceOpen={searching}>
                <TreeNodes
                  nodes={actions}
                  depth={1}
                  forceOpen={searching}
                  renderItem={(key, depth) => {
                    const a = actionByKey(key);
                    return (
                      <ListItemButton
                        sx={{ pl: 2 + depth * 2 }}
                        onClick={() => {
                          p.openTab(a.key, `New → ${a.name}`);
                          close();
                        }}
                      >
                        <ListItemText primary={a.name} secondary={`admin · ${a.source}`} />
                      </ListItemButton>
                    );
                  }}
                />
              </Folder>
            </List>
          </li>
        )}
        <ListSubheader>Saved ({countItems(nodes)})</ListSubheader>
        <li>
          <List disablePadding dense>
            <TreeNodes
              nodes={nodes}
              depth={0}
              forceOpen={searching}
              renderItem={(id, depth) => {
                const s = byId.get(id)!;
                return (
                  <SavedItemRow
                    s={s}
                    who={p.who}
                    depth={depth}
                    onOpen={() => {
                      p.openSaved(s);
                      close();
                    }}
                    onMore={(el) => setMore({ el, s })}
                  />
                );
              }}
            />
          </List>
        </li>
        {nodes.length === 0 && <MenuItem disabled>Nothing matches</MenuItem>}
        {p.onLibrary && <Divider />}
        {p.onLibrary && (
          <MenuItem
            onClick={() => {
              p.onLibrary!();
              close();
            }}
          >
            Open library…
          </MenuItem>
        )}
      </Menu>
      <Menu anchorEl={more?.el} open={!!more} onClose={() => setMore(null)}>
        {m && [
          <MenuItem key="open" onClick={act(() => p.openSaved(m), true)}>
            Open
          </MenuItem>,
          own && (
            <MenuItem key="edit" onClick={act(() => setEditing(m), true)}>
              Edit…
            </MenuItem>
          ),
          <MenuItem key="dup" onClick={act(() => p.duplicate(m))}>
            Duplicate as mine
          </MenuItem>,
          own ? (
            <MenuItem key="del" onClick={act(() => p.remove(m))}>
              Delete
            </MenuItem>
          ) : m.hiddenBy.includes(p.who) ? (
            <MenuItem key="unhide" onClick={act(() => p.unhide(m))}>
              Unhide
            </MenuItem>
          ) : (
            <MenuItem key="hide" onClick={act(() => p.hide(m))}>
              Hide from my menus
            </MenuItem>
          ),
          own && <Divider key="vdiv" />,
          own && <ListSubheader key="vis">Visibility</ListSubheader>,
          ...(own
            ? (
                [
                  [false, 'Only me'],
                  [true, 'Everyone (read-only)'],
                ] as const
              ).map(([shared, label]) => (
                <MenuItem
                  key={label}
                  onClick={act(() => {
                    if (m.shared !== shared) p.upsert({ ...m, shared });
                  })}
                >
                  <ListItemIcon>
                    {m.shared === shared && <CheckIcon fontSize="small" />}
                  </ListItemIcon>
                  {label}
                </MenuItem>
              ))
            : []),
          <Divider key="div" />,
          <MenuItem key="yaml" onClick={act(() => setYaml(toYaml(m)), true)}>
            Copy as action file
          </MenuItem>,
        ]}
      </Menu>
      {editing && (
        <Dialog open onClose={() => setEditing(null)} maxWidth="md" fullWidth>
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
      {yaml && (
        <Dialog open onClose={() => setYaml(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Action file (for an admin to add)</DialogTitle>
          <DialogContent>
            <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{yaml}</pre>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setYaml(null)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}
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

/** Chips: type and press Enter, or pick a suggestion. No comma-separated text. */
function ChipsField({
  label,
  values,
  options = [],
  placeholder,
  error,
  helperText,
  onChange,
}: {
  label: string;
  values: string[];
  options?: string[];
  placeholder?: string;
  error?: boolean;
  helperText?: string;
  onChange: (values: string[]) => void;
}) {
  return (
    <Autocomplete
      multiple
      freeSolo
      size="small"
      options={options}
      value={values}
      onChange={(_e, v) => onChange(v)}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={values.length ? undefined : placeholder}
          error={error}
          helperText={helperText}
        />
      )}
      sx={{ flex: 1, minWidth: 220 }}
    />
  );
}

/** The value of an input: a text field, or chips for a dynamic (array) input, stored as JSON. */
function ValueField({
  input: i,
  label,
  helperText,
  onChange,
}: {
  input: Input;
  label: string;
  helperText?: string;
  onChange: (value: string) => void;
}) {
  return isArray(i) ? (
    <ChipsField
      label={label}
      values={parseArray(i.value)}
      placeholder={PLACEHOLDER.dynamic}
      helperText={helperText}
      onChange={(vs) => onChange(JSON.stringify(vs))}
    />
  ) : (
    <TextField
      size="small"
      label={label}
      value={i.value}
      placeholder={PLACEHOLDER[i.type] ?? 'value'}
      slotProps={{ inputLabel: { shrink: true } }}
      onChange={(e) => onChange(e.target.value)}
      helperText={helperText}
      sx={{ flex: 1, minWidth: 200 }}
    />
  );
}

/**
 * One input. In the tab (`editing` false) it is just a value to run with. In the save dialog it is
 * Fixed (the value is saved) or From row (columns to fill it from; no value).
 */
function InputRow({
  input: i,
  label,
  editing,
  onChange,
  onDelete,
}: {
  input: Input;
  label?: string;
  editing: boolean;
  onChange: (i: Input) => void;
  onDelete?: () => void;
}) {
  const row = i.mode === 'row';
  return (
    <Stack direction="row" sx={{ gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {i.via === 'query' && (
        <>
          <Chip size="small" color="primary" label={i.name} onDelete={onDelete} sx={{ mt: 1 }} />
          <TextField
            select
            size="small"
            value={i.type}
            onChange={(e) => onChange({ ...i, type: e.target.value, value: '' })}
            sx={{ width: 160 }}
          >
            {TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {t === 'dynamic' ? 'dynamic (array)' : t}
              </MenuItem>
            ))}
          </TextField>
        </>
      )}
      {editing && (
        <ToggleButtonGroup
          size="small"
          exclusive
          value={i.mode}
          onChange={(_e, m: Input['mode'] | null) => m && onChange({ ...i, mode: m })}
        >
          <ToggleButton value="fixed">Fixed</ToggleButton>
          <ToggleButton value="row">From row</ToggleButton>
        </ToggleButtonGroup>
      )}
      {editing && row ? (
        <ChipsField
          label={
            isArray(i)
              ? 'From columns, every selected row (first match wins)'
              : 'From columns (first match wins)'
          }
          values={i.columns}
          // No suggestions: the columns are in results the analyst will pivot from, which they know.
          placeholder="Type a column name, then Enter"
          error={i.columns.length === 0}
          helperText={
            i.columns.length === 0 ? 'Add a column to offer it on right-click' : undefined
          }
          onChange={(columns) => onChange({ ...i, columns })}
        />
      ) : (
        <ValueField
          input={i}
          label={label ?? i.name}
          helperText={editing ? undefined : isArray(i) ? 'Array: sent as JSON' : undefined}
          onChange={(value) => onChange({ ...i, value })}
        />
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
  editing,
  onChange,
}: {
  a: ActionDef;
  inputs: Input[];
  editing: boolean;
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
          ? 'Write :name in the SQL; it is picked up here. A dynamic (array) parameter arrives as JSON text: use PARSE_JSON(:name).'
          : 'Reference a parameter by name in the KQL and add it here; TIM adds the declare statement. A dynamic parameter is a dynamic array.'}
        {editing ? '' : ' Choose fixed or from-row when saving.'}
      </Typography>
      <Stack sx={{ gap: 1 }}>
        {qp.map((i) => (
          <InputRow
            key={i.name}
            input={i}
            editing={editing}
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
  const origin = p.tab.fromSaved ? p.saved.find((s) => s.id === p.tab.fromSaved) : undefined;
  const setInputs = (inputs: Input[]) => p.updateTab({ inputs });

  const field = (param: ParamDef) => {
    const input = p.tab.inputs.find((i) => i.name === param.name);
    if (input)
      return (
        <InputRow
          key={param.name}
          input={input}
          label={param.label}
          editing={false}
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
        <Button startIcon={<StarBorderIcon />} onClick={() => setSaving(p.fromTab())}>
          Save…
        </Button>
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
        <QueryParams a={a} inputs={p.tab.inputs} editing={false} onChange={setInputs} />
      )}

      <MockGrid {...p} />

      {saving && (
        <Dialog open onClose={() => setSaving(null)} maxWidth="lg" fullWidth>
          <DialogTitle>Save {hasQuery(a) ? 'query' : `${a.name} params`}</DialogTitle>
          <SaveEditor
            initial={saving}
            origin={origin}
            who={p.who}
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
  origin,
  who,
  onSave,
  onCancel,
  inline,
}: {
  initial: Saved;
  /** The saved item the tab was opened from: yours can be updated; anyone else's is copied. */
  origin?: Saved;
  who?: string;
  onSave: (s: Saved) => void;
  onCancel?: () => void;
  inline?: boolean;
}) {
  const own = !!origin && origin.owner === who;
  const copyName = origin ? `${origin.name} (copy)` : '';
  const [target, setTarget] = useState<'update' | 'new'>(own ? 'update' : 'new');
  const [s, setS] = useState(origin && !own ? { ...initial, name: copyName } : initial);
  const pick = (t: 'update' | 'new') => {
    setTarget(t);
    // Keep the name in step with the choice unless the analyst has typed their own.
    if (t === 'new' && s.name === origin!.name) setS({ ...s, name: copyName });
    if (t === 'update' && s.name === copyName) setS({ ...s, name: origin!.name });
  };
  const a = actionByKey(s.actionKey);
  const setInputs = (inputs: Input[]) => setS({ ...s, inputs });
  const open = openInputs(s.inputs);
  const body = (
    <Stack sx={{ gap: 2, pt: 1 }}>
      {own && (
        <RadioGroup value={target} onChange={(e) => pick(e.target.value as 'update' | 'new')}>
          <FormControlLabel
            value="update"
            control={<Radio size="small" />}
            label={`Update "${origin.name}": anyone opening it from now on gets this version; open tabs keep theirs`}
          />
          <FormControlLabel
            value="new"
            control={<Radio size="small" />}
            label={`Save as a new item: "${origin.name}" stays as it is`}
          />
        </RadioGroup>
      )}
      {origin && !own && (
        <Typography variant="body2" color="text.secondary">
          Opened from {origin.owner.split('@')[0]}'s "{origin.name}". This saves a new item of your
          own; theirs is unchanged.
        </Typography>
      )}
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
              editing
              onChange={(next) => setInputs(s.inputs.map((x) => (x.name === i.name ? next : x)))}
            />
          ))}
        {hasQuery(a) && <QueryParams a={a} inputs={s.inputs} editing onChange={setInputs} />}
      </Stack>
      <Box>
        <Typography variant="subtitle2">
          What the backend receives (from-row inputs show a placeholder for the row's value)
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
      <Button
        variant="contained"
        onClick={() => onSave(own && target === 'update' ? { ...s, id: origin.id } : s)}
      >
        {!origin ? 'Save' : own && target === 'update' ? 'Update' : 'Save new'}
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
  const [selected, setSelected] = useState<number[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; rows: Record<string, string>[] } | null>(
    null,
  );
  const [search, setSearch] = useState('');
  const m = menu ? p.pivotMenu() : null;
  const close = () => {
    setMenu(null);
    setSearch('');
  };
  const select = (i: number, e: MouseEvent) =>
    setSelected((sel) =>
      e.ctrlKey || e.metaKey
        ? sel.includes(i)
          ? sel.filter((x) => x !== i)
          : [...sel, i]
        : e.shiftKey && sel.length
          ? Array.from(
              { length: Math.abs(i - sel[sel.length - 1]!) + 1 },
              (_, k) => Math.min(i, sel[sel.length - 1]!) + k,
            )
          : [i],
    );
  const tree = m ? savedTree(m.pivots, search) : [];
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        Results (mock). Click to select; Ctrl-click or Shift-click for more rows; right-click to
        pivot on the selection.
      </Typography>
      <Box
        component="table"
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
          userSelect: 'none',
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
            <Box
              component="tr"
              key={i}
              aria-selected={selected.includes(i)}
              onClick={(e) => select(i, e)}
              onContextMenu={(e) => {
                e.preventDefault();
                // Right-clicking outside the selection selects just that row, like a grid does.
                const rows = selected.includes(i) ? selected : [i];
                setSelected(rows);
                setMenu({ x: e.clientX, y: e.clientY, rows: rows.map((k) => ROWS[k]!) });
              }}
              sx={{
                cursor: 'default',
                bgcolor: selected.includes(i) ? 'action.selected' : undefined,
              }}
            >
              {COLUMNS.map((c) => (
                <td key={c}>{r[c]}</td>
              ))}
            </Box>
          ))}
        </tbody>
      </Box>
      <Menu
        open={!!menu}
        onClose={close}
        autoFocus={false}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
        slotProps={{ paper: { sx: { width: 440, maxHeight: '85vh' } } }}
      >
        <ListSubheader>
          {menu?.rows.length === 1 ? '1 row' : `${menu?.rows.length} rows`} selected
        </ListSubheader>
        <ListSubheader>Actions</ListSubheader>
        {m?.actions.map((a) => {
          const inputs = syncInputs(a, {}, []);
          const problem = rowsProblem(inputs, menu!.rows);
          return (
            <MenuItem
              key={a.key}
              disabled={!!problem}
              onClick={() => {
                p.openTab(a.key, `pivot (${menu!.rows.length} rows) → ${a.name}`, {
                  inputs: fromRows(inputs, menu!.rows),
                });
                close();
              }}
            >
              <ListItemText primary={`${a.menu} / ${a.name}`} secondary={problem} />
            </MenuItem>
          );
        })}
        <ListSubheader>Saved pivots</ListSubheader>
        {m?.pivots.length === 0 && <MenuItem disabled>None match these columns</MenuItem>}
        {m && m.pivots.length > 0 && <MenuSearch value={search} onChange={setSearch} />}
        {m && (
          <li>
            <List disablePadding dense>
              <TreeNodes
                nodes={tree}
                depth={0}
                forceOpen={search.trim() !== ''}
                renderItem={(id, depth) => {
                  const s = m.pivots.find((x) => x.id === id)!;
                  return (
                    <SavedItemRow
                      s={s}
                      who={p.who}
                      depth={depth}
                      problem={rowsProblem(s.inputs, menu!.rows)}
                      onOpen={() => {
                        p.openSaved(s, menu!.rows);
                        close();
                      }}
                    />
                  );
                }}
              />
            </List>
          </li>
        )}
        {m && m.pivots.length > 0 && tree.length === 0 && (
          <MenuItem disabled>Nothing matches</MenuItem>
        )}
      </Menu>
    </Box>
  );
}
