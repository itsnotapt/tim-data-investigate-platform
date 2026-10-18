// PROTOTYPE (wayfinder "Action tab"): throwaway, in-memory only, never merged.
// Question: what does the action tab look like and how does it behave? The param form built from
// declared params (connections, kql/sql editors, many-valued and advanced params), run and cancel
// with the succeeded / error / timedOut / cancelled endings, where run details and columns show,
// and a pivot with a required param still empty opening the form instead of running.
// Three variants on one route, switchable with ?variant=A|B|C. There's no API: the catalogue, runs
// and results are mocked, and the bottom bar picks how the next run ends.
// Run with `npm run prototype:action-tab`.
import { useEffect, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import {
  Alert,
  AlertTitle,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Popover,
  Snackbar,
  Stack,
  Switch,
  Tab as MuiTab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import ErrorIcon from '@mui/icons-material/Error';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SaveIcon from '@mui/icons-material/Save';
import ShareIcon from '@mui/icons-material/Share';
import StopIcon from '@mui/icons-material/Stop';
import TimerOffIcon from '@mui/icons-material/TimerOff';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { CodeEditor } from '../../components/CodeEditor';
import { PrototypeSwitcher, usePrototypeVariant } from '../../components/PrototypeSwitcher';

// ---------------------------------------------------------------- mock instance (GET /api/instance)

type Kind =
  'string' | 'number' | 'boolean' | 'datetime' | 'timespan' | 'json' | 'kql' | 'sql' | 'connection';
type Value = string | number | boolean | string[] | null;
type Values = Record<string, Value>;

interface Param {
  name: string;
  label: string;
  kind: Kind;
  required: boolean;
  many: boolean;
  default?: Value;
  choices?: string[];
  fromColumns?: string[];
  help?: string;
  advanced?: boolean;
  /** Prototype shortcut for a `connection` param's backend. */
  backend?: string;
}
interface Action {
  key: string;
  name: string;
  description?: string;
  menuPath: string;
  connections: string[];
  params: Param[];
  pivot: { rows: 'row' | 'rows'; columns: string[][] } | null;
}
interface Connection {
  name: string;
  backend: string;
  title: string;
}

const CONNECTIONS: Connection[] = [
  { name: 'security-prod', backend: 'kusto', title: 'Security (prod)' },
  { name: 'security-dev', backend: 'kusto', title: 'Security (dev)' },
  { name: 'snowflake-prod', backend: 'snowflake', title: 'Snowflake (prod)' },
  { name: 'virustotal', backend: 'virustotal', title: 'VirusTotal' },
];
const DATABASES: Record<string, string[]> = {
  'security-prod': ['SecurityLogs', 'DeviceEvents', 'Identity'],
  'security-dev': ['SecurityLogsDev'],
};

const p = (x: Partial<Param> & Pick<Param, 'name' | 'label' | 'kind'>): Param => ({
  required: false,
  many: false,
  ...x,
});

const ACTIONS: Action[] = [
  {
    key: 'run_kql',
    name: 'Run KQL',
    description: 'Ad-hoc KQL against a Kusto connection.',
    menuPath: 'Kusto',
    connections: ['security-prod', 'security-dev'],
    params: [
      p({
        name: 'connection',
        label: 'Connection',
        kind: 'connection',
        backend: 'kusto',
        required: true,
        default: 'security-prod',
      }),
      p({
        name: 'database',
        label: 'Database',
        kind: 'string',
        required: true,
        default: 'SecurityLogs',
      }),
      p({
        name: 'kql',
        label: 'KQL',
        kind: 'kql',
        required: true,
        default:
          'DeviceProcessEvents\n| where Timestamp > ago(1d)\n| where ProcessName in~ ("powershell.exe", "certutil.exe")\n| take 100',
      }),
      p({
        name: 'idColumn',
        label: 'Id column',
        kind: 'string',
        advanced: true,
        help: 'Column whose value tags each row. Without one, rows are tagged by a hash of every value.',
      }),
      p({
        name: 'serverTimeout',
        label: 'Server timeout',
        kind: 'timespan',
        advanced: true,
        help: "Kusto's servertimeout, capped by the instance's run timeout.",
      }),
    ],
    pivot: null,
  },
  {
    key: 'run_sql',
    name: 'Run SQL',
    description: 'Ad-hoc SQL against a Snowflake connection.',
    menuPath: 'Snowflake',
    connections: ['snowflake-prod'],
    params: [
      p({
        name: 'connection',
        label: 'Connection',
        kind: 'connection',
        backend: 'snowflake',
        required: true,
        default: 'snowflake-prod',
      }),
      p({
        name: 'sql',
        label: 'SQL',
        kind: 'sql',
        required: true,
        default:
          'SELECT EVENT_TIME, USER_PRINCIPAL_NAME, EVENT_TYPE, OUTCOME, CLIENT_IP\nFROM OKTA.SYSTEM_LOG\nWHERE EVENT_TIME > DATEADD(day, -1, CURRENT_TIMESTAMP())\nLIMIT 100',
      }),
      p({
        name: 'idColumn',
        label: 'Id column',
        kind: 'string',
        advanced: true,
        help: 'Column whose value tags each row. Without one, rows are tagged by a hash of every value.',
      }),
    ],
    pivot: null,
  },
  {
    key: 'device_timeline',
    name: 'Device timeline',
    description: 'Process, network and file events on devices around a time.',
    menuPath: 'Endpoint',
    connections: ['security-prod'],
    params: [
      p({
        name: 'devices',
        label: 'Devices',
        kind: 'string',
        many: true,
        required: true,
        fromColumns: ['DeviceName', 'Computer'],
      }),
      p({
        name: 'around',
        label: 'Around',
        kind: 'datetime',
        required: true,
        fromColumns: ['Timestamp'],
      }),
      p({
        name: 'window',
        label: 'Window',
        kind: 'timespan',
        default: '1h',
        help: '± around the time',
      }),
      p({
        name: 'eventTypes',
        label: 'Event types',
        kind: 'string',
        many: true,
        choices: ['process', 'network', 'file', 'registry'],
        default: ['process', 'network'],
      }),
      p({
        name: 'includeBenign',
        label: 'Include benign',
        kind: 'boolean',
        advanced: true,
        default: false,
        help: 'Also show events Defender marks as benign.',
      }),
    ],
    pivot: { rows: 'rows', columns: [['DeviceName', 'Computer'], ['Timestamp']] },
  },
  {
    key: 'user_signins',
    name: 'User sign-ins',
    description: 'Entra ID and Okta sign-ins for one user.',
    menuPath: 'Identity',
    connections: ['snowflake-prod'],
    params: [
      p({
        name: 'connection',
        label: 'Connection',
        kind: 'connection',
        backend: 'snowflake',
        required: true,
        default: 'snowflake-prod',
      }),
      p({
        name: 'upn',
        label: 'User',
        kind: 'string',
        required: true,
        fromColumns: ['AccountUpn', 'UserPrincipalName', 'USER_PRINCIPAL_NAME'],
      }),
      p({ name: 'since', label: 'Since', kind: 'datetime', required: true }),
      p({ name: 'until', label: 'Until', kind: 'datetime', help: 'Empty means now.' }),
      p({ name: 'failedOnly', label: 'Failed only', kind: 'boolean', default: false }),
    ],
    pivot: { rows: 'row', columns: [['AccountUpn', 'UserPrincipalName', 'USER_PRINCIPAL_NAME']] },
  },
  {
    key: 'file_reputation',
    name: 'File reputation',
    description: 'VirusTotal verdicts for file hashes.',
    menuPath: 'Threat intel',
    connections: ['virustotal'],
    params: [
      p({
        name: 'hashes',
        label: 'SHA-256 hashes',
        kind: 'string',
        many: true,
        required: true,
        fromColumns: ['SHA256'],
      }),
    ],
    pivot: { rows: 'rows', columns: [['SHA256']] },
  },
];
const actionOf = (key: string) => ACTIONS.find((a) => a.key === key)!;
const connectionChoices = (prm: Param) => CONNECTIONS.filter((c) => c.backend === prm.backend);
const isEditor = (prm: Param) => prm.kind === 'kql' || prm.kind === 'sql';

// ---------------------------------------------------------------- mock results

type Cell = string | number | boolean;
type Row = Record<string, Cell>;
type ColType = 'string' | 'number' | 'boolean' | 'datetime' | 'timespan' | 'json';
interface Column {
  name: string;
  type: ColType;
  /** Who said what the type is: the action, the backend's hook, or TIM guessing. */
  source: 'action' | 'backend' | 'inferred';
}
type Detail = [string, Cell];

const DEVICES = ['WS-0042', 'WS-0107', 'SRV-DB01', 'WS-0311', 'LAP-7781'];
const USERS = ['alex@contoso.com', 'sam@contoso.com', 'priya@contoso.com', 'jo@contoso.com'];
const PROCS = ['powershell.exe', 'certutil.exe', 'rundll32.exe', 'mshta.exe', 'cmd.exe'];
const hex = (seed: number) => {
  let s = (seed * 2654435761) >>> 0;
  let out = '';
  for (let i = 0; i < 64; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    out += ((s >>> 16) & 15).toString(16);
  }
  return out;
};
const ts = (i: number, base = Date.UTC(2026, 9, 18, 9, 14)) =>
  new Date(base - i * 97_000).toISOString().slice(0, 19) + 'Z';

const cols = (source: Column['source'], spec: [string, ColType][]): Column[] =>
  spec.map(([name, type]) => ({ name, type, source }));

function mockResult(a: Action, v: Values): { columns: Column[]; rows: Row[]; details: Detail[] } {
  const list = (x: Value | undefined) => (Array.isArray(x) ? x : []);
  switch (a.key) {
    case 'run_kql': {
      const rows = Array.from({ length: 24 }, (_, i) => ({
        Timestamp: ts(i),
        DeviceName: DEVICES[i % 5]!,
        AccountUpn: USERS[i % 4]!,
        ProcessName: PROCS[(i * 3) % 5]!,
        ProcessId: 4000 + i * 17,
        SHA256: hex(i % 7),
      }));
      const details: Detail[] = [
        ['executionTime', '0:00:00.84'],
        ['cpuTime', '0:00:01.27'],
        ['memoryPeak', '138 MB'],
      ];
      if (!v.idColumn)
        details.push(['warning', 'No Id column: rows are tagged by a hash of all values']);
      return {
        columns: cols('backend', [
          ['Timestamp', 'datetime'],
          ['DeviceName', 'string'],
          ['AccountUpn', 'string'],
          ['ProcessName', 'string'],
          ['ProcessId', 'number'],
          ['SHA256', 'string'],
        ]),
        rows,
        details,
      };
    }
    case 'run_sql':
      return {
        columns: cols('backend', [
          ['EVENT_TIME', 'datetime'],
          ['USER_PRINCIPAL_NAME', 'string'],
          ['EVENT_TYPE', 'string'],
          ['OUTCOME', 'string'],
          ['CLIENT_IP', 'string'],
        ]),
        rows: Array.from({ length: 18 }, (_, i) => ({
          EVENT_TIME: ts(i * 3),
          USER_PRINCIPAL_NAME: USERS[i % 4]!,
          EVENT_TYPE: i % 3 ? 'user.session.start' : 'user.authentication.auth_via_mfa',
          OUTCOME: i % 5 ? 'SUCCESS' : 'FAILURE',
          CLIENT_IP: `203.0.113.${10 + i}`,
        })),
        details: [
          ['queryId', '01b7c3e2-0603-8f1a-0000-4a2d0019c2be'],
          ['warehouse', 'ANALYST_WH'],
          ['bytesScanned', '1.4 GB'],
        ],
      };
    case 'device_timeline': {
      const devices = list(v.devices);
      const types = list(v.eventTypes).length ? list(v.eventTypes) : ['process'];
      const rows: Row[] = [];
      devices.forEach((d, di) =>
        Array.from({ length: 6 }, (_, i) => {
          const type = types[i % types.length]!;
          rows.push({
            Timestamp: ts(i * 2 + di),
            DeviceName: d,
            EventType: type,
            Detail:
              type === 'process'
                ? `${PROCS[i % 5]} -enc JAB…`
                : type === 'network'
                  ? `198.51.100.${20 + i}:443`
                  : `C:\\Users\\Public\\${i}.dll`,
            SHA256: hex(i + di),
          });
        }),
      );
      const details: Detail[] = [['sources', 'Defender, Sysmon']];
      if (devices.includes('WS-0107')) details.push(['warning', 'Sysmon has no data for WS-0107']);
      return {
        columns: cols('action', [
          ['Timestamp', 'datetime'],
          ['DeviceName', 'string'],
          ['EventType', 'string'],
          ['Detail', 'string'],
          ['SHA256', 'string'],
        ]),
        rows,
        details,
      };
    }
    case 'user_signins':
      return {
        columns: cols('backend', [
          ['Timestamp', 'datetime'],
          ['UserPrincipalName', 'string'],
          ['App', 'string'],
          ['IPAddress', 'string'],
          ['Country', 'string'],
          ['Result', 'string'],
        ]),
        rows: Array.from({ length: 12 }, (_, i) => ({
          Timestamp: ts(i * 11),
          UserPrincipalName: String(v.upn),
          App: ['Outlook', 'Teams', 'Azure Portal', 'Okta Dashboard'][i % 4]!,
          IPAddress: `203.0.113.${40 + i}`,
          Country: i === 3 ? 'RO' : 'GB',
          Result: i === 3 || (i === 7 && !v.failedOnly) ? 'Failure' : 'Success',
        })).filter((r) => !v.failedOnly || r.Result === 'Failure'),
        details: [['source', 'Entra ID + Okta (Snowflake)']],
      };
    case 'file_reputation': {
      const hashes = list(v.hashes);
      return {
        columns: cols('action', [
          ['SHA256', 'string'],
          ['Verdict', 'string'],
          ['Detections', 'number'],
          ['FirstSeen', 'datetime'],
          ['Signer', 'string'],
        ]),
        rows: hashes.map((h, i) => ({
          SHA256: h,
          Verdict: i % 3 === 0 ? 'malicious' : i % 3 === 1 ? 'clean' : 'unknown',
          Detections: i % 3 === 0 ? 41 + i : 0,
          FirstSeen: ts(i * 900),
          Signer: i % 3 === 1 ? 'Microsoft Windows' : '',
        })),
        details: [
          ['provider', 'VirusTotal v3'],
          ['httpStatus', 200],
          ['cacheHits', Math.min(2, hashes.length)],
        ],
      };
    }
    default:
      return { columns: [], rows: [], details: [] };
  }
}

const RUN_ERRORS: Record<string, string> = {
  run_kql:
    "Semantic error: 'DeviceProcesEvents' could not be resolved.\n(line 1, position 1)\nRequest id: 3f1c9a2e-7d1b-4c55-9c0e-1a2b3c4d5e6f",
  run_sql: "SQL compilation error:\nObject 'OKTA.SYSTEM_LOGS' does not exist or not authorized.",
  device_timeline: 'Defender advanced hunting returned 429 Too Many Requests. Retry in 60 s.',
  user_signins: 'Snowflake: warehouse ANALYST_WH is suspended.',
  file_reputation: 'VirusTotal returned HTTP 429: quota exceeded.',
};
/** A 422 with `errors: {"params.<name>": …}`, one per action. */
const VALIDATION: Record<string, [string, string]> = {
  run_kql: ['serverTimeout', 'Not a timespan: use 30s, 10m or 1h'],
  run_sql: ['sql', 'Must be a single statement'],
  device_timeline: ['window', 'At most 7d'],
  user_signins: ['until', 'Must be after Since'],
  file_reputation: ['hashes', "'abc123' is not a SHA-256 hash"],
};
/** OBO and connection errors are synchronous: no run exists. */
const START_ERRORS: Record<string, string> = {
  kusto:
    "Couldn't get a token for security-prod on your behalf: AADSTS50076, multi-factor authentication is required. Sign in again.",
  snowflake:
    "Couldn't get a Snowflake token for snowflake-prod on your behalf: AADSTS65001, consent required. Ask a TIM admin to grant consent.",
  virustotal: "virustotal: the instance's workload identity was refused (403).",
};

// ---------------------------------------------------------------- tabs and runs

type Status = 'running' | 'succeeded' | 'error' | 'timedOut' | 'cancelled';
type Outcome = 'succeed' | 'slow' | 'error' | 'timeout' | 'validation' | 'connection';
const OUTCOMES: [Outcome, string][] = [
  ['succeed', 'succeeds (2.5 s)'],
  ['slow', 'is slow (30 s, cancel it)'],
  ['error', 'errors'],
  ['timeout', 'times out (5 s)'],
  ['validation', '422 on a param'],
  ['connection', 'token error (sync)'],
];

interface Run {
  runId: string;
  status: Status;
  cancelling?: boolean;
  /** Resolved params the run was started with. */
  params: Values;
  startedAt: number;
  finishedAt?: number;
  details: Detail[];
  columns?: Column[];
  rows?: Row[];
  error?: string;
}
interface Tab {
  id: string;
  parentId: string | null;
  title: string;
  action: string;
  /** The form's current values; a run snapshots them into `run.params`. */
  values: Values;
  run: Run | null;
  /** Latest succeeded run, still shown while a newer one runs or after it fails. */
  lastGood: Run | null;
  /** Required params a pivot couldn't fill, with the reason. */
  missing: Record<string, string>;
  errors: Record<string, string>;
  startError: string | null;
  formOpen: boolean;
  /** Advanced params the analyst added to the form (B, C). */
  added: string[];
}

const isEmpty = (v: Value | undefined) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const emptyFor = (prm: Param): Value => (prm.many ? [] : prm.kind === 'boolean' ? false : '');
const defaults = (a: Action): Values =>
  Object.fromEntries(a.params.map((x) => [x.name, x.default ?? emptyFor(x)]));
const omit = <T,>(o: Record<string, T>, k: string) =>
  Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** An advanced param counts as set when it differs from its default. */
const isSet = (prm: Param, v: Value | undefined) =>
  !isEmpty(v) && !same(v, prm.default ?? emptyFor(prm));
const dirty = (t: Tab) => !!t.run && !same(t.values, t.run.params);

const fmtValue = (prm: Param, v: Value | undefined): string => {
  if (isEmpty(v)) return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (prm.kind === 'datetime') return String(v).replace('T', ' ');
  return String(v);
};
const fmtShort = (prm: Param, v: Value | undefined): string => {
  if (Array.isArray(v) && v.length > 1) return `${shortCell(v[0]!)} +${v.length - 1}`;
  if (Array.isArray(v) && v.length === 1) return shortCell(v[0]!);
  return shortCell(fmtValue(prm, v));
};
const shortCell = (s: string) => (s.length > 24 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s);
const fmtDuration = (ms: number) =>
  ms < 60_000
    ? `${(ms / 1000).toFixed(1)} s`
    : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
const fmtElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtClock = (t: number) => new Date(t).toLocaleTimeString();
const fmtCell = (v: Cell) => (typeof v === 'number' ? v.toLocaleString() : String(v));

let seq = 0;
const nextId = (prefix: string) => `${prefix}${++seq}`;

function finishRun(t: Tab, status: Status, at: number): Tab {
  if (!t.run) return t;
  const duration: Detail = ['duration', fmtDuration(at - t.run.startedAt)];
  if (status !== 'succeeded') {
    return {
      ...t,
      run: {
        ...t.run,
        status,
        cancelling: false,
        finishedAt: at,
        details: [duration],
        error: status === 'error' ? RUN_ERRORS[t.action] : undefined,
      },
    };
  }
  const res = mockResult(actionOf(t.action), t.run.params);
  const run: Run = {
    ...t.run,
    status,
    finishedAt: at,
    details: [duration, ['rowCount', res.rows.length], ...res.details],
    columns: res.columns,
    rows: res.rows,
  };
  return { ...t, run, lastGood: run };
}

type Begin = { tab: Tab; result: 'started' | 'invalid' | 'refused'; delay?: number; end?: Status };

function begin(t: Tab, outcome: Outcome): Begin {
  const a = actionOf(t.action);
  const errors: Record<string, string> = {};
  for (const prm of a.params)
    if (prm.required && isEmpty(t.values[prm.name]))
      errors[prm.name] = t.missing[prm.name] ?? 'Required';
  if (Object.keys(errors).length) return { tab: { ...t, errors }, result: 'invalid' };
  if (outcome === 'validation') {
    const [name, msg] = VALIDATION[a.key]!;
    return { tab: { ...t, errors: { [name]: msg }, startError: null }, result: 'invalid' };
  }
  if (outcome === 'connection') {
    const backend = CONNECTIONS.find((c) => c.name === a.connections[0])!.backend;
    return { tab: { ...t, errors: {}, startError: START_ERRORS[backend]! }, result: 'refused' };
  }
  const run: Run = {
    runId: nextId('run-'),
    status: 'running',
    params: { ...t.values },
    startedAt: Date.now(),
    details: [],
  };
  const [delay, end]: [number, Status] =
    outcome === 'slow'
      ? [30_000, 'succeeded']
      : outcome === 'error'
        ? [1500, 'error']
        : outcome === 'timeout'
          ? [5000, 'timedOut']
          : [2500, 'succeeded'];
  return {
    tab: { ...t, run, errors: {}, missing: {}, startError: null },
    result: 'started',
    delay,
    end,
  };
}

/** Default `resolve()`: `from_columns` fill params, `many` collects distinct values. */
function resolve(a: Action, rows: Row[]): { values: Values; missing: Record<string, string> } {
  const values = defaults(a);
  const missing: Record<string, string> = {};
  for (const prm of a.params) {
    let reason = 'No column in the rows gives it';
    if (prm.fromColumns) {
      const col = prm.fromColumns.find((c) => rows.some((r) => c in r));
      const vals = col
        ? [
            ...new Set(
              rows
                .map((r) => r[col])
                .filter((x) => x !== undefined && x !== '')
                .map(String),
            ),
          ]
        : [];
      if (prm.many && vals.length) values[prm.name] = vals;
      else if (vals.length === 1)
        values[prm.name] = prm.kind === 'datetime' ? vals[0]!.slice(0, 16) : vals[0]!;
      else if (vals.length > 1) reason = `The ${rows.length} selected rows have different ${col}s`;
      else reason = `None of ${prm.fromColumns.join(', ')} in the row`;
    }
    if (prm.required && isEmpty(values[prm.name])) missing[prm.name] = reason;
  }
  return { values, missing };
}

function makeTab(action: string, over: Partial<Tab> & { values?: Values } = {}): Tab {
  const a = actionOf(action);
  return {
    id: nextId('tab-'),
    parentId: null,
    title: a.name,
    action,
    values: defaults(a),
    run: null,
    lastGood: null,
    missing: {},
    errors: {},
    startError: null,
    formOpen: true,
    added: [],
    ...over,
  };
}

function seedTabs(): Tab[] {
  const now = Date.now();
  const done = (t: Tab, ago: number): Tab => {
    const started = {
      ...t,
      run: {
        runId: nextId('run-'),
        status: 'running' as const,
        params: { ...t.values },
        startedAt: now - ago,
        details: [],
      },
    };
    return { ...finishRun(started, 'succeeded', now - ago + 2300), formOpen: false };
  };
  const kql = done(makeTab('run_kql', { title: 'PowerShell and certutil, last day' }), 120_000);
  const timeline = done(
    makeTab('device_timeline', {
      parentId: kql.id,
      title: 'Device timeline: WS-0042',
      values: {
        ...defaults(actionOf('device_timeline')),
        devices: ['WS-0042'],
        around: '2026-10-18T09:14',
      },
    }),
    60_000,
  );
  return [kql, timeline];
}

// ---------------------------------------------------------------- page

const VARIANTS = [
  { key: 'A', name: 'Toolbar + collapsible form' },
  { key: 'B', name: 'Side panel' },
  { key: 'C', name: 'Param pills + inner tabs' },
] as const;
const VARIANT_KEYS = VARIANTS.map((v) => v.key);

interface Ops {
  setValue: (name: string, v: Value) => void;
  setFormOpen: (open: boolean) => void;
  setAdded: (names: string[]) => void;
  run: () => Begin['result'];
  cancel: () => void;
  reset: () => void;
  pivot: (action: string, rows: Row[]) => void;
  save: () => void;
  share: () => void;
  clone: () => void;
}
interface VariantProps {
  tab: Tab;
  action: Action;
  ops: Ops;
}

export function ActionTabPage() {
  const variant = usePrototypeVariant(VARIANT_KEYS);
  const [tabs, setTabs] = useState<Tab[]>(seedTabs);
  const [activeId, setActiveId] = useState<string>(() => tabs[0]!.id);
  const [outcome, setOutcome] = useState<Outcome>('succeed');
  const [toast, setToast] = useState<{ message: string; goTo?: string } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const active = tabs.find((t) => t.id === activeId) ?? null;

  const patch = (id: string, fn: (t: Tab) => Tab) =>
    setTabs((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
  const schedule = (id: string, b: Begin) => {
    if (b.result !== 'started' || !b.tab.run) return;
    const runId = b.tab.run.runId;
    setTimeout(() => {
      const at = Date.now();
      patch(id, (t) =>
        t.run?.runId === runId && t.run.status === 'running' && !t.run.cancelling
          ? finishRun(t, b.end!, at)
          : t,
      );
    }, b.delay);
  };
  /** Pivots open in the background (`focus` false) so several can start from one row. */
  const add = (t: Tab, run: boolean, focus = true) => {
    const b = run ? begin(t, outcome) : null;
    setTabs((ts) => [...ts, b?.tab ?? t]);
    if (focus) setActiveId(t.id);
    if (b) schedule(t.id, b);
  };

  const opsFor = (tab: Tab): Ops => ({
    setValue: (name, v) =>
      patch(tab.id, (t) => {
        const missing = omit(t.missing, name);
        const errors = omit(t.errors, name);
        return { ...t, values: { ...t.values, [name]: v }, missing, errors };
      }),
    setFormOpen: (formOpen) => patch(tab.id, (t) => ({ ...t, formOpen })),
    setAdded: (added) => patch(tab.id, (t) => ({ ...t, added })),
    run: () => {
      const b = begin(tab, outcome);
      patch(tab.id, () => b.tab);
      schedule(tab.id, b);
      return b.result;
    },
    cancel: () => {
      const runId = tab.run?.runId;
      patch(tab.id, (t) => (t.run ? { ...t, run: { ...t.run, cancelling: true } } : t));
      // POST /api/runs/{id}/cancel; the status turns cancelled once Hook.cancel() returns.
      setTimeout(() => {
        const at = Date.now();
        patch(tab.id, (t) =>
          t.run?.runId === runId && t.run?.status === 'running' ? finishRun(t, 'cancelled', at) : t,
        );
      }, 700);
    },
    reset: () =>
      patch(tab.id, (t) => ({
        ...t,
        values: { ...(t.run?.params ?? defaults(actionOf(t.action))) },
        errors: {},
      })),
    pivot: (key, rows) => {
      const a = actionOf(key);
      const { values, missing } = resolve(a, rows);
      const first = a.params.find((x) => x.fromColumns && !isEmpty(values[x.name]));
      const title = first ? `${a.name}: ${fmtShort(first, values[first.name])}` : a.name;
      const t = makeTab(key, { parentId: tab.id, title, values, missing, formOpen: true });
      const ready = Object.keys(missing).length === 0;
      add(ready ? { ...t, formOpen: false } : { ...t, errors: {} }, ready, false);
      const needs = Object.keys(missing)
        .map((n) => a.params.find((x) => x.name === n)!.label)
        .join(', ');
      setToast({
        message: ready ? `Running ${title}` : `Opened ${title}: needs ${needs}`,
        goTo: t.id,
      });
    },
    save: () => setSaveOpen(true),
    share: () =>
      setToast({
        message: 'Link copied. It opens a new tab with these params filled in, and never runs.',
      }),
    clone: () =>
      add(
        makeTab(tab.action, {
          parentId: tab.parentId,
          title: `Copy of ${tab.title}`,
          values: { ...tab.values },
          added: tab.added,
        }),
        false,
      ),
  });

  const VariantView = variant === 'B' ? VariantB : variant === 'C' ? VariantC : VariantA;
  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        tabs={tabs}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={(key) => add(makeTab(key), false)}
      />
      <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', pb: 12 }}>
        {active && (
          <VariantView
            key={`${variant}-${active.id}`}
            tab={active}
            action={actionOf(active.action)}
            ops={opsFor(active)}
          />
        )}
      </Box>
      {active && <StatePanel tab={active} />}
      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast?.message}
        action={
          toast?.goTo && (
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                setActiveId(toast.goTo!);
                setToast(null);
              }}
            >
              Go to
            </Button>
          )
        }
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      />
      <Dialog open={saveOpen} onClose={() => setSaveOpen(false)}>
        <DialogTitle>Save…</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            The Save… dialog from the Saved params prototype: name, menu folder, visibility, Fixed /
            From row per input, and a preview. Not repeated here.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      <PrototypeSwitcher
        variants={VARIANTS}
        state={
          <label>
            next run{' '}
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
              {OUTCOMES.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        }
      />
    </Box>
  );
}

function StatePanel({ tab }: { tab: Tab }) {
  const { run, lastGood, ...rest } = tab;
  const brief = (r: Run | null) =>
    r && {
      runId: r.runId,
      status: r.status + (r.cancelling ? ' (cancelling)' : ''),
      params: r.params,
      details: Object.fromEntries(r.details),
      error: r.error,
    };
  return (
    <Box
      component="details"
      sx={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 1999,
        maxWidth: 420,
        maxHeight: '60vh',
        overflow: 'auto',
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        boxShadow: 3,
        p: 1,
        font: '11px/1.4 monospace',
      }}
    >
      <summary style={{ cursor: 'pointer' }}>tab state</summary>
      <pre style={{ margin: 0 }}>
        {JSON.stringify(
          {
            ...rest,
            dirty: dirty(tab),
            run: brief(run),
            lastGood: lastGood?.runId ?? null,
          },
          null,
          2,
        )}
      </pre>
    </Box>
  );
}

// ---------------------------------------------------------------- shell

const STATUS: Record<
  Status,
  { label: string; color: 'info' | 'success' | 'error' | 'warning' | 'default'; icon: ReactElement }
> = {
  running: { label: 'Running', color: 'info', icon: <CircularProgress size={14} /> },
  succeeded: {
    label: 'Succeeded',
    color: 'success',
    icon: <CheckCircleIcon fontSize="small" color="success" />,
  },
  error: { label: 'Error', color: 'error', icon: <ErrorIcon fontSize="small" color="error" /> },
  timedOut: {
    label: 'Timed out',
    color: 'warning',
    icon: <TimerOffIcon fontSize="small" color="warning" />,
  },
  cancelled: {
    label: 'Cancelled',
    color: 'default',
    icon: <BlockIcon fontSize="small" color="disabled" />,
  },
};

function Sidebar({
  tabs,
  activeId,
  onSelect,
  onNew,
}: {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: (action: string) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const folders = [...new Set(ACTIONS.map((a) => a.menuPath))];
  const render = (parentId: string | null, depth: number): ReactNode =>
    tabs
      .filter((t) => t.parentId === parentId)
      .map((t) => (
        <Box key={t.id}>
          <ListItemButton
            dense
            selected={t.id === activeId}
            onClick={() => onSelect(t.id)}
            sx={{ pl: 1 + depth * 2 }}
          >
            <ListItemIcon sx={{ minWidth: 26 }}>
              {t.run ? (
                STATUS[t.run.status].icon
              ) : Object.keys(t.missing).length ? (
                <Tooltip title="Needs input before it can run">
                  <WarningAmberIcon fontSize="small" color="warning" />
                </Tooltip>
              ) : (
                <EditIcon fontSize="small" color="disabled" />
              )}
            </ListItemIcon>
            <ListItemText
              primary={t.title}
              slotProps={{ primary: { noWrap: true, sx: { fontSize: 13 } } }}
            />
          </ListItemButton>
          {render(t.id, depth + 1)}
        </Box>
      ));
  return (
    <Box
      sx={{ width: 260, flexShrink: 0, borderRight: 1, borderColor: 'divider', overflow: 'auto' }}
    >
      <Box sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          TIM{' '}
          <Typography component="span" variant="caption" color="warning.main">
            prototype
          </Typography>
        </Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={(e) => setAnchor(e.currentTarget)}>
          New
        </Button>
      </Box>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {folders.flatMap((f) => [
          <ListSubheader key={f}>{f}</ListSubheader>,
          ...ACTIONS.filter((a) => a.menuPath === f).map((a) => (
            <MenuItem
              key={a.key}
              onClick={() => {
                onNew(a.key);
                setAnchor(null);
              }}
            >
              <ListItemText primary={a.name} secondary={a.description} />
            </MenuItem>
          )),
        ])}
      </Menu>
      <Divider />
      <List dense disablePadding>
        {render(null, 0)}
      </List>
    </Box>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const h = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(h);
  }, [active]);
  return now;
}

// ---------------------------------------------------------------- shared widgets

const missingSx = {
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'warning.main', borderWidth: 2 },
  '& .MuiFormHelperText-root': { color: 'warning.main' },
};

function ParamField({
  param,
  values,
  value,
  onChange,
  error,
  missing,
  autoFocus,
  size = 'small',
}: {
  param: Param;
  values: Values;
  value: Value | undefined;
  onChange: (v: Value) => void;
  error?: string;
  missing?: string;
  autoFocus?: boolean;
  size?: 'small' | 'medium';
}) {
  const label = param.label + (param.required ? ' *' : '');
  const helper = error ?? missing ?? param.help;
  const common = {
    label,
    size,
    fullWidth: true,
    autoFocus,
    error: !!error,
    helperText: helper,
    sx: missing && !error ? missingSx : undefined,
  };
  if (param.kind === 'connection') {
    return (
      <TextField
        {...common}
        select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        slotProps={{
          select: {
            renderValue: (v) => CONNECTIONS.find((c) => c.name === v)?.title ?? String(v),
          },
        }}
      >
        {connectionChoices(param).map((c) => (
          <MenuItem key={c.name} value={c.name}>
            <ListItemText primary={c.title} secondary={c.name} />
          </MenuItem>
        ))}
      </TextField>
    );
  }
  if (param.kind === 'boolean') {
    return (
      <Box>
        <FormControlLabel
          control={
            <Switch
              checked={value === true}
              onChange={(e) => onChange(e.target.checked)}
              size={size}
            />
          }
          label={param.label}
        />
        {helper && (
          <Typography
            variant="caption"
            color={error ? 'error' : 'text.secondary'}
            sx={{ display: 'block', ml: 1 }}
          >
            {helper}
          </Typography>
        )}
      </Box>
    );
  }
  if (param.many) {
    const list = Array.isArray(value) ? value : [];
    return (
      <Autocomplete
        multiple
        freeSolo={!param.choices}
        options={param.choices ?? []}
        value={list}
        onChange={(_, v) => onChange(v)}
        size={size}
        renderInput={(ip) => (
          <TextField
            {...ip}
            {...common}
            placeholder={list.length ? '' : param.choices ? 'Pick…' : 'Type or paste, Enter to add'}
            onPaste={(e) => {
              if (param.choices) return;
              const parts = e.clipboardData
                .getData('text')
                .split(/[\s,;]+/)
                .filter(Boolean);
              if (parts.length > 1) {
                e.preventDefault();
                onChange([...new Set([...list, ...parts])]);
              }
            }}
          />
        )}
      />
    );
  }
  if (param.choices) {
    return (
      <TextField {...common} select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {param.choices.map((c) => (
          <MenuItem key={c} value={c}>
            {c}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  if (param.name === 'database') {
    const options = DATABASES[String(values.connection)] ?? [];
    return (
      <Autocomplete
        freeSolo
        options={options}
        value={String(value ?? '')}
        onInputChange={(_, v) => onChange(v)}
        size={size}
        renderInput={(ip) => <TextField {...ip} {...common} />}
      />
    );
  }
  return (
    <TextField
      {...common}
      value={value ?? ''}
      type={
        param.kind === 'number' ? 'number' : param.kind === 'datetime' ? 'datetime-local' : 'text'
      }
      placeholder={param.kind === 'timespan' ? '30s, 10m, 1h, 2d' : undefined}
      multiline={param.kind === 'json'}
      slotProps={{ inputLabel: { shrink: true } }}
      onChange={(e) => onChange(param.kind === 'number' ? Number(e.target.value) : e.target.value)}
    />
  );
}

function QueryEditor({
  tab,
  param,
  value,
  onChange,
  height,
  error,
}: {
  tab: Tab;
  param: Param;
  value: Value | undefined;
  onChange: (v: string) => void;
  height: number | string;
  error?: string;
}) {
  const scope = [tab.values.connection, tab.values.database].filter(Boolean).join(' / ');
  return (
    <Box>
      <Box
        sx={{
          height,
          border: error ? 2 : 1,
          borderColor: error ? 'error.main' : 'divider',
          resize: 'vertical',
          overflow: 'hidden',
        }}
      >
        <CodeEditor
          language={param.kind === 'kql' ? 'kusto' : 'plaintext'}
          path={`${tab.id}-${param.name}.${param.kind}`}
          ariaLabel={param.label}
          value={String(value ?? '')}
          onChange={onChange}
        />
      </Box>
      <Typography variant="caption" color={error ? 'error' : 'text.secondary'}>
        {error ??
          `${param.label}: completion from the ${scope} schema (not loaded in the prototype)`}
      </Typography>
    </Box>
  );
}

function DetailValue({ k, v }: { k: string; v: Cell }) {
  return k === 'warning' ? (
    <Box
      component="span"
      sx={{ color: 'warning.main', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
    >
      <WarningAmberIcon sx={{ fontSize: 14 }} />
      {String(v)}
    </Box>
  ) : (
    <>{fmtCell(v)}</>
  );
}

function MockGrid({
  run,
  dim,
  onPivot,
  showTypes,
  footer,
  height = 420,
}: {
  run: Run;
  dim?: boolean;
  onPivot: (action: string, rows: Row[]) => void;
  showTypes?: boolean;
  footer?: ReactNode;
  height?: number | string;
}) {
  const columns = run.columns ?? [];
  const rows = run.rows ?? [];
  const [selected, setSelected] = useState<number[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; rows: Row[] } | null>(null);
  const names = columns.map((c) => c.name);
  const pivots = ACTIONS.filter(
    (a) => a.pivot && a.pivot.columns.every((alts) => alts.some((c) => names.includes(c))),
  );
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
  return (
    <Box sx={{ opacity: dim ? 0.4 : 1, transition: 'opacity .2s' }}>
      <Box sx={{ height, overflow: 'auto', border: 1, borderColor: 'divider' }}>
        <Box
          component="table"
          sx={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 12,
            userSelect: 'none',
            '& td, & th': {
              borderBottom: 1,
              borderColor: 'divider',
              px: 1,
              py: 0.5,
              whiteSpace: 'nowrap',
              textAlign: 'left',
            },
            '& th': { position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1 },
          }}
        >
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.name}>
                  {c.name}
                  {showTypes && (
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.secondary"
                      sx={{ ml: 0.75, fontWeight: 400 }}
                    >
                      {c.type}
                    </Typography>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Box
                component="tr"
                key={i}
                onClick={(e) => select(i, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const sel = selected.includes(i) ? selected : [i];
                  setSelected(sel);
                  setMenu({ x: e.clientX, y: e.clientY, rows: sel.map((k) => rows[k]!) });
                }}
                sx={{ bgcolor: selected.includes(i) ? 'action.selected' : undefined }}
              >
                {columns.map((c) => (
                  <Box
                    component="td"
                    key={c.name}
                    sx={{
                      textAlign: c.type === 'number' ? 'right' : undefined,
                      fontFamily: c.name === 'SHA256' ? 'monospace' : undefined,
                    }}
                  >
                    {r[c.name] === undefined
                      ? ''
                      : c.name === 'SHA256'
                        ? shortCell(String(r[c.name]))
                        : fmtCell(r[c.name]!)}
                  </Box>
                ))}
              </Box>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length || 1}>No rows</td>
              </tr>
            )}
          </tbody>
        </Box>
      </Box>
      {footer}
      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
        slotProps={{ paper: { sx: { width: 320 } } }}
      >
        <ListSubheader>
          {menu?.rows.length === 1 ? '1 row' : `${menu?.rows.length} rows`} selected · pivot to
        </ListSubheader>
        {pivots.length === 0 && <MenuItem disabled>No action takes these columns</MenuItem>}
        {pivots.map((a) => {
          const tooMany = a.pivot!.rows === 'row' && (menu?.rows.length ?? 0) > 1;
          return (
            <MenuItem
              key={a.key}
              disabled={tooMany}
              onClick={() => {
                onPivot(a.key, menu!.rows);
                setMenu(null);
              }}
            >
              <ListItemText
                primary={`${a.menuPath} / ${a.name}`}
                secondary={tooMany ? 'Takes one row' : undefined}
              />
            </MenuItem>
          );
        })}
      </Menu>
    </Box>
  );
}

// ---------------------------------------------------------------- variant A: toolbar + collapsible form
// Today's tab, evolved: a toolbar, a form that collapses into a one-line summary once it runs,
// endings as banners, the last good results kept (dimmed while running), and run details in a
// status bar under the grid with column types in the headers.

function VariantA({ tab, action, ops }: VariantProps) {
  const running = tab.run?.status === 'running';
  const now = useNow(running);
  const editors = action.params.filter(isEditor);
  const basic = action.params.filter((x) => !isEditor(x) && !x.advanced);
  const adv = action.params.filter((x) => x.advanced);
  const [moreToggle, setMoreToggle] = useState(() => adv.some((x) => isSet(x, tab.values[x.name])));
  const moreOpen = moreToggle || adv.some((x) => tab.errors[x.name] || tab.missing[x.name]);
  const shown = tab.run?.status === 'succeeded' ? tab.run : tab.lastGood;
  const missingNames = Object.keys(tab.missing);

  const runNow = () => {
    const r = ops.run();
    ops.setFormOpen(r !== 'started');
  };
  const field = (x: Param) => (
    <ParamField
      key={x.name}
      param={x}
      values={tab.values}
      value={tab.values[x.name]}
      onChange={(v) => ops.setValue(x.name, v)}
      error={tab.errors[x.name]}
      missing={tab.missing[x.name]}
    />
  );
  const advSummary = adv
    .filter((x) => isSet(x, tab.values[x.name]))
    .map((x) => `${x.label}: ${fmtValue(x, tab.values[x.name])}`)
    .join(' · ');

  return (
    <Box>
      <Stack
        direction="row"

        spacing={0.5}
        sx={{ alignItems: 'center', px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider' }}
      >
        {running ? (
          <Button
            size="small"
            color="error"
            startIcon={tab.run?.cancelling ? <CircularProgress size={14} /> : <StopIcon />}
            disabled={tab.run?.cancelling}
            onClick={ops.cancel}
          >
            {tab.run?.cancelling
              ? 'Cancelling…'
              : `Cancel (${fmtElapsed(now - tab.run!.startedAt)})`}
          </Button>
        ) : (
          <Button size="small" startIcon={<PlayArrowIcon />} onClick={runNow}>
            Run
          </Button>
        )}
        <Button size="small" color="inherit" startIcon={<ContentCopyIcon />} onClick={ops.clone}>
          Clone
        </Button>
        <Divider orientation="vertical" flexItem />
        <Button
          size="small"
          color="inherit"
          startIcon={tab.formOpen ? <ExpandLess /> : <EditIcon />}
          onClick={() => ops.setFormOpen(!tab.formOpen)}
        >
          {tab.formOpen ? 'Hide params' : 'Edit params'}
        </Button>
        <Divider orientation="vertical" flexItem />
        <Button size="small" color="inherit" startIcon={<SaveIcon />} onClick={ops.save}>
          Save…
        </Button>
        <Button size="small" color="inherit" startIcon={<ShareIcon />} onClick={ops.share}>
          Share link
        </Button>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {action.menuPath} / {action.name}
        </Typography>
      </Stack>

      <Box sx={{ px: 2, pt: 1.5 }}>
        <Typography variant="h6" sx={{ fontSize: 17 }}>
          {tab.title}
        </Typography>
      </Box>

      <Collapse in={tab.formOpen}>
        <Box sx={{ mx: 2, mt: 1, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          {missingNames.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              This pivot needs{' '}
              {missingNames.map((n) => action.params.find((x) => x.name === n)!.label).join(', ')}{' '}
              before it can run. The other values came from the selected rows.
            </Alert>
          )}
          {action.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {action.description}
            </Typography>
          )}
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              alignItems: 'start',
            }}
          >
            {basic.map(field)}
          </Box>
          {editors.map((x) => (
            <Box key={x.name} sx={{ mt: 2 }}>
              <QueryEditor
                tab={tab}
                param={x}
                value={tab.values[x.name]}
                onChange={(v) => ops.setValue(x.name, v)}
                height={260}
                error={tab.errors[x.name]}
              />
            </Box>
          ))}
          {adv.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Button
                size="small"
                color="inherit"
                startIcon={moreOpen ? <ExpandLess /> : <ExpandMore />}
                onClick={() => setMoreToggle(!moreOpen)}
              >
                More options ({adv.length})
              </Button>
              {!moreOpen && advSummary && (
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 1 }}
                >
                  {advSummary}
                </Typography>
              )}
              <Collapse in={moreOpen}>
                <Box
                  sx={{
                    display: 'grid',
                    gap: 2,
                    mt: 1.5,
                    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                    alignItems: 'start',
                  }}
                >
                  {adv.map(field)}
                </Box>
              </Collapse>
            </Box>
          )}
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button
              variant="contained"
              size="small"
              startIcon={<PlayArrowIcon />}
              onClick={runNow}
              disabled={running}
            >
              Run
            </Button>
            {dirty(tab) && (
              <Button size="small" color="inherit" onClick={ops.reset}>
                Discard changes
              </Button>
            )}
          </Stack>
        </Box>
      </Collapse>

      {!tab.formOpen && (
        <Box
          onClick={() => ops.setFormOpen(true)}
          sx={{
            mx: 2,
            mt: 1,
            px: 1,
            py: 0.75,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.75,
            alignItems: 'center',
            cursor: 'pointer',
            borderRadius: 1,
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          {[...basic, ...adv]
            .filter(
              (x) => !isEmpty(tab.values[x.name]) && (!x.advanced || isSet(x, tab.values[x.name])),
            )
            .map((x) => (
              <Chip
                key={x.name}
                size="small"
                variant="outlined"
                label={`${x.label}: ${fmtShort(x, tab.values[x.name])}`}
              />
            ))}
          {editors.map((x) => (
            <Typography
              key={x.name}
              variant="caption"
              sx={{ fontFamily: 'monospace', color: 'text.secondary', maxWidth: 480 }}
              noWrap
            >
              {String(tab.values[x.name] ?? '')
                .split('\n')
                .join(' ')}
            </Typography>
          ))}
          {dirty(tab) && <Chip size="small" color="warning" label="edited since the last run" />}
        </Box>
      )}

      <Box sx={{ mx: 2, mt: 1 }}>
        {tab.startError && (
          <Alert severity="error" sx={{ mb: 1 }}>
            <AlertTitle>Couldn't start the run</AlertTitle>
            {tab.startError}
          </Alert>
        )}
        {running && (
          <Box sx={{ mb: 1 }}>
            <LinearProgress />
            <Typography variant="caption" color="text.secondary">
              {tab.run?.cancelling
                ? 'Cancelling…'
                : `Running for ${fmtElapsed(now - tab.run!.startedAt)}, started ${fmtClock(tab.run!.startedAt)}`}
            </Typography>
          </Box>
        )}
        {tab.run?.status === 'error' && (
          <Alert
            severity="error"
            sx={{ mb: 1 }}
            action={
              !tab.formOpen && (
                <Button color="inherit" size="small" onClick={() => ops.setFormOpen(true)}>
                  Edit params
                </Button>
              )
            }
          >
            <AlertTitle>
              The run failed after {fmtDuration(tab.run.finishedAt! - tab.run.startedAt)}
            </AlertTitle>
            <Box
              component="pre"
              sx={{ m: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}
            >
              {tab.run.error}
            </Box>
          </Alert>
        )}
        {tab.run?.status === 'timedOut' && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            Timed out after {fmtDuration(tab.run.finishedAt! - tab.run.startedAt)}, the instance's
            run timeout. Narrow the params and run again.
          </Alert>
        )}
        {tab.run?.status === 'cancelled' && (
          <Alert severity="info" sx={{ mb: 1 }}>
            Cancelled after {fmtDuration(tab.run.finishedAt! - tab.run.startedAt)}.
          </Alert>
        )}
        {shown && tab.run && shown !== tab.run && !running && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Showing results of the previous run at {fmtClock(shown.startedAt)}
            {!same(shown.params, tab.run.params) && ' (different params)'}.
          </Typography>
        )}
        {shown ? (
          <MockGrid
            run={shown}
            dim={running}
            onPivot={ops.pivot}
            showTypes
            footer={
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  columnGap: 2,
                  rowGap: 0.25,
                  px: 1,
                  py: 0.5,
                  border: 1,
                  borderTop: 0,
                  borderColor: 'divider',
                  fontSize: 12,
                  color: 'text.secondary',
                }}
              >
                {shown.details.map(([k, v]) => (
                  <span key={k}>
                    {k}:{' '}
                    <Box component="span" sx={{ color: 'text.primary' }}>
                      <DetailValue k={k} v={v} />
                    </Box>
                  </span>
                ))}
              </Box>
            }
          />
        ) : (
          !running && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              No results yet.
            </Typography>
          )
        )}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------- variant B: side panel
// Params live in an always-editable panel on the left with Run pinned at its foot; optional params
// are added on demand. Query editors sit at the top of the main area. A rerun clears the results;
// a run header shows status, duration and rows, and Details opens a drawer with everything.

function VariantB({ tab, action, ops }: VariantProps) {
  const running = tab.run?.status === 'running';
  const now = useNow(running);
  const [drawer, setDrawer] = useState(false);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const editors = action.params.filter(isEditor);
  const adv = action.params.filter((x) => x.advanced);
  const advShown = adv.filter(
    (x) => tab.added.includes(x.name) || isSet(x, tab.values[x.name]) || tab.errors[x.name],
  );
  const advHidden = adv.filter((x) => !advShown.includes(x));
  const panelParams = action.params.filter((x) => !isEditor(x) && !x.advanced);
  const run = tab.run;
  const warning = run?.details.find(([k]) => k === 'warning');

  const field = (x: Param) => {
    if (x.kind === 'connection' && connectionChoices(x).length === 1) {
      return (
        <Typography key={x.name} variant="caption" color="text.secondary">
          Runs on {connectionChoices(x)[0]!.title} ({connectionChoices(x)[0]!.name})
        </Typography>
      );
    }
    return (
      <ParamField
        key={x.name}
        param={x}
        values={tab.values}
        value={tab.values[x.name]}
        onChange={(v) => ops.setValue(x.name, v)}
        error={tab.errors[x.name]}
        missing={tab.missing[x.name]}
      />
    );
  };

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: '100%' }}>
      <Box
        sx={{
          borderRight: 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <Box sx={{ p: 2, overflow: 'auto', flex: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {action.menuPath}
          </Typography>
          <Typography variant="h6" sx={{ fontSize: 17, lineHeight: 1.2 }}>
            {action.name}
          </Typography>
          {action.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {action.description}
            </Typography>
          )}
          {Object.keys(tab.missing).length > 0 && (
            <Alert severity="warning" icon={<InfoOutlinedIcon />} sx={{ mb: 2, py: 0 }}>
              Fill in the highlighted params to run this pivot.
            </Alert>
          )}
          <Stack spacing={2}>{panelParams.map(field)}</Stack>
          {adv.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="overline" color="text.secondary">
                Optional
              </Typography>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {advShown.map((x) => (
                  <Stack
                    key={x.name}
                    direction="row"
                    spacing={0.5}
                    sx={{ alignItems: 'flex-start' }}
                  >
                    <Box sx={{ flex: 1 }}>{field(x)}</Box>
                    <IconButton
                      size="small"
                      aria-label={`Remove ${x.label}`}
                      onClick={() => {
                        ops.setValue(x.name, x.default ?? emptyFor(x));
                        ops.setAdded(tab.added.filter((n) => n !== x.name));
                      }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
              {advHidden.length > 0 && (
                <>
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={(e) => setAddAnchor(e.currentTarget)}
                    sx={{ mt: 1 }}
                  >
                    Add option
                  </Button>
                  <Menu anchorEl={addAnchor} open={!!addAnchor} onClose={() => setAddAnchor(null)}>
                    {advHidden.map((x) => (
                      <MenuItem
                        key={x.name}
                        onClick={() => {
                          ops.setAdded([...tab.added, x.name]);
                          setAddAnchor(null);
                        }}
                      >
                        <ListItemText
                          primary={x.label}
                          secondary={x.help}
                          slotProps={{ secondary: { sx: { whiteSpace: 'normal', maxWidth: 280 } } }}
                        />
                      </MenuItem>
                    ))}
                  </Menu>
                </>
              )}
            </Box>
          )}
        </Box>
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          {dirty(tab) && !running && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', mb: 1 }}>
              Changed since the last run ·{' '}
              <Box
                component="span"
                sx={{ textDecoration: 'underline', cursor: 'pointer' }}
                onClick={ops.reset}
              >
                reset
              </Box>
            </Typography>
          )}
          {running ? (
            <Button
              fullWidth
              variant="outlined"
              color="error"
              startIcon={run?.cancelling ? <CircularProgress size={16} /> : <StopIcon />}
              disabled={run?.cancelling}
              onClick={ops.cancel}
            >
              {run?.cancelling ? 'Cancelling…' : `Cancel · ${fmtElapsed(now - run!.startedAt)}`}
            </Button>
          ) : (
            <Button
              fullWidth
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={() => ops.run()}
            >
              Run
            </Button>
          )}
        </Box>
      </Box>

      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" sx={{ alignItems: 'center', px: 2, py: 1 }} spacing={0.5}>
          <Typography variant="subtitle1" sx={{ flex: 1 }} noWrap>
            {tab.title}
          </Typography>
          <Tooltip title="Save…">
            <IconButton size="small" onClick={ops.save}>
              <SaveIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Share link">
            <IconButton size="small" onClick={ops.share}>
              <ShareIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Clone">
            <IconButton size="small" onClick={ops.clone}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        {editors.map((x) => (
          <Box key={x.name} sx={{ px: 2, pb: 1 }}>
            <QueryEditor
              tab={tab}
              param={x}
              value={tab.values[x.name]}
              onChange={(v) => ops.setValue(x.name, v)}
              height={220}
              error={tab.errors[x.name]}
            />
          </Box>
        ))}
        {(run || tab.startError) && (
          <Stack
            direction="row"

            spacing={1.5}
            sx={{
              alignItems: 'center',
              px: 2,
              py: 0.75,
              borderTop: 1,
              borderBottom: 1,
              borderColor: 'divider',
              bgcolor: 'action.hover',
            }}
          >
            {tab.startError ? (
              <Chip size="small" color="error" label="Not started" />
            ) : (
              run && (
                <Chip
                  size="small"
                  color={STATUS[run.status].color}
                  label={run.cancelling ? 'Cancelling' : STATUS[run.status].label}
                />
              )
            )}
            {run && !tab.startError && (
              <Typography variant="body2" color="text.secondary">
                {run.status === 'running'
                  ? `${fmtElapsed(now - run.startedAt)} · started ${fmtClock(run.startedAt)}`
                  : [
                      fmtDuration(run.finishedAt! - run.startedAt),
                      run.rows && `${run.rows.length.toLocaleString()} rows`,
                      `finished ${fmtClock(run.finishedAt!)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
              </Typography>
            )}
            {warning && !tab.startError && (
              <Tooltip title={String(warning[1])}>
                <WarningAmberIcon fontSize="small" color="warning" />
              </Tooltip>
            )}
            <Box sx={{ flex: 1 }} />
            {run && !tab.startError && run.status !== 'running' && (
              <Button size="small" onClick={() => setDrawer(true)}>
                Details ({run.details.length + (run.columns?.length ? 1 : 0)})
              </Button>
            )}
          </Stack>
        )}
        <Box sx={{ p: 2, flex: 1, minHeight: 0 }}>
          {tab.startError ? (
            <Alert severity="error">{tab.startError}</Alert>
          ) : !run ? (
            <Typography variant="body2" color="text.secondary">
              Fill in the params and Run.
            </Typography>
          ) : run.status === 'running' ? (
            <Stack spacing={1} sx={{ alignItems: 'center', mt: 6 }}>
              <CircularProgress />
              <Typography variant="body2" color="text.secondary">
                {run.cancelling ? 'Cancelling…' : 'Results appear when the run finishes.'}
              </Typography>
            </Stack>
          ) : run.status === 'succeeded' ? (
            <MockGrid run={run} onPivot={ops.pivot} height="calc(100vh - 260px)" />
          ) : run.status === 'error' ? (
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 2,
                whiteSpace: 'pre-wrap',
                fontFamily: 'monospace',
                fontSize: 12,
                color: 'error.main',
                border: 1,
                borderColor: 'error.main',
                borderRadius: 1,
              }}
            >
              {run.error}
            </Box>
          ) : (
            <Stack spacing={1} sx={{ alignItems: 'center', mt: 6, color: 'text.secondary' }}>
              {STATUS[run.status].icon}
              <Typography variant="body2">
                {run.status === 'timedOut'
                  ? "Stopped at the instance's run timeout. Narrow the params and run again."
                  : 'You cancelled this run.'}
              </Typography>
            </Stack>
          )}
        </Box>
      </Box>

      <Drawer anchor="right" open={drawer} onClose={() => setDrawer(false)}>
        {run && <RunInfo run={run} action={action} width={400} />}
      </Drawer>
    </Box>
  );
}

function RunInfo({ run, action, width }: { run: Run; action: Action; width?: number }) {
  const dl = (rows: [string, ReactNode][]) => (
    <Box
      component="dl"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'max-content 1fr',
        columnGap: 2,
        rowGap: 0.5,
        m: 0,
        fontSize: 13,
        '& dt': { color: 'text.secondary' },
        '& dd': { m: 0, wordBreak: 'break-word' },
      }}
    >
      {rows.map(([k, v]) => (
        <Box key={k} sx={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </Box>
      ))}
    </Box>
  );
  const section = (title: string, body: ReactNode) => (
    <Box sx={{ mb: 2.5 }}>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      {body}
    </Box>
  );
  return (
    <Box sx={{ width, p: 2 }}>
      {section(
        'Run',
        dl([
          [
            'status',
            <Chip
              key="s"
              size="small"
              color={STATUS[run.status].color}
              label={STATUS[run.status].label}
            />,
          ],
          ['started', fmtClock(run.startedAt)],
          ['finished', run.finishedAt ? fmtClock(run.finishedAt) : '—'],
          ['expires', fmtClock(run.startedAt + 24 * 3600_000) + ' tomorrow'],
          ['run id', <code key="r">{run.runId}</code>],
        ]),
      )}
      {run.error &&
        section(
          'Error',
          <Box
            component="pre"
            sx={{ m: 0, whiteSpace: 'pre-wrap', fontSize: 12, color: 'error.main' }}
          >
            {run.error}
          </Box>,
        )}
      {section(
        'Details',
        dl(run.details.map(([k, v]) => [k, <DetailValue key={k} k={k} v={v} />])),
      )}
      {run.columns &&
        section(
          `Columns (${run.columns.length})`,
          dl(
            run.columns.map((c) => [
              c.name,
              `${c.type}${c.source === 'action' ? ' · declared by the action' : c.source === 'backend' ? ' · from the backend' : ' · guessed'}`,
            ]),
          ),
        )}
      {section(
        'Params',
        dl(
          action.params
            .filter((x) => !isEmpty(run.params[x.name]))
            .map((x) => [
              x.label,
              isEditor(x) ? (
                <Box
                  key={x.name}
                  component="pre"
                  sx={{ m: 0, fontSize: 11, whiteSpace: 'pre-wrap' }}
                >
                  {String(run.params[x.name])}
                </Box>
              ) : (
                fmtValue(x, run.params[x.name])
              ),
            ]),
        ),
      )}
    </Box>
  );
}

// ---------------------------------------------------------------- variant C: param pills + inner tabs
// The action reads as one line of pills (click one to edit it in a popover; missing ones are red
// and dashed), with Run at the line's end. Below, inner tabs: Query (editors only), Results and
// Run (status, error, details, columns, resolved params). The view follows the run: results on
// success, the Run tab on any other ending.

type View = 'query' | 'results' | 'run';

function VariantC({ tab, action, ops }: VariantProps) {
  const run = tab.run;
  const running = run?.status === 'running';
  const now = useNow(running);
  const editors = action.params.filter(isEditor);
  const adv = action.params.filter((x) => x.advanced);
  const pills = action.params.filter(
    (x) =>
      !isEditor(x) &&
      (!x.advanced ||
        tab.added.includes(x.name) ||
        isSet(x, tab.values[x.name]) ||
        !!tab.errors[x.name]),
  );
  const addable = adv.filter((x) => !pills.includes(x));
  const [pop, setPop] = useState<{ name: string; el: HTMLElement } | null>(null);
  const [pick, setPick] = useState<{ key: string; view: View } | null>(null);
  const key = `${run?.runId}:${run?.status}:${tab.startError ? 'x' : ''}`;
  const auto: View = tab.startError
    ? 'run'
    : !run
      ? editors.length
        ? 'query'
        : 'results'
      : run.status === 'running'
        ? editors.length
          ? 'query'
          : 'results'
        : run.status === 'succeeded'
          ? 'results'
          : 'run';
  const view = pick?.key === key ? pick.view : auto;
  const shown = run?.status === 'succeeded' ? run : tab.lastGood;
  const missingNames = Object.keys(tab.missing);
  const popParam = pop && action.params.find((x) => x.name === pop.name);

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {action.menuPath} / {action.name} · {tab.title}
        </Typography>
        <Tooltip title="Save…">
          <IconButton size="small" onClick={ops.save}>
            <SaveIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Share link">
          <IconButton size="small" onClick={ops.share}>
            <ShareIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Clone">
          <IconButton size="small" onClick={ops.clone}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack
        direction="row"

        sx={{
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
          pb: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="h6" sx={{ fontSize: 18, mr: 0.5 }}>
          {action.name}
        </Typography>
        {pills.map((x) => {
          const single = x.kind === 'connection' && connectionChoices(x).length === 1;
          const err = tab.errors[x.name];
          const miss = tab.missing[x.name];
          const empty = isEmpty(tab.values[x.name]);
          return (
            <Tooltip key={x.name} title={err ?? miss ?? x.help ?? ''}>
              <Chip
                size="medium"
                variant={empty && !miss && !err ? 'outlined' : 'filled'}
                color={err ? 'error' : miss ? 'warning' : 'default'}
                disabled={single}
                onClick={single ? undefined : (e) => setPop({ name: x.name, el: e.currentTarget })}
                onDelete={
                  x.advanced
                    ? () => {
                        ops.setValue(x.name, x.default ?? emptyFor(x));
                        ops.setAdded(tab.added.filter((n) => n !== x.name));
                      }
                    : undefined
                }
                label={
                  <span>
                    <Box component="span" sx={{ opacity: 0.7 }}>
                      {x.label}:{' '}
                    </Box>
                    {miss ? 'needed' : fmtShort(x, tab.values[x.name])}
                  </span>
                }
                sx={{
                  borderStyle: miss ? 'dashed' : undefined,
                  ...(miss
                    ? {
                        border: 2,
                        borderColor: 'warning.main',
                        bgcolor: 'transparent',
                        color: 'warning.main',
                      }
                    : {}),
                }}
              />
            </Tooltip>
          );
        })}
        {addable.map((x) => (
          <Tooltip key={x.name} title={x.help ?? ''}>
            <Button
              size="small"
              color="inherit"
              startIcon={<AddIcon />}
              sx={{ color: 'text.secondary', textTransform: 'none' }}
              onClick={() => ops.setAdded([...tab.added, x.name])}
            >
              {x.label}
            </Button>
          </Tooltip>
        ))}
        <Box sx={{ flex: 1 }} />
        {dirty(tab) && !running && (
          <Tooltip title="Reset to the last run's params">
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              label="edited"
              onDelete={ops.reset}
            />
          </Tooltip>
        )}
        {running ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <CircularProgress size={20} />
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {fmtElapsed(now - run.startedAt)}
            </Typography>
            <Button
              variant="outlined"
              color="error"
              size="small"
              startIcon={<StopIcon />}
              disabled={run?.cancelling}
              onClick={ops.cancel}
            >
              {run?.cancelling ? 'Cancelling…' : 'Cancel'}
            </Button>
          </Stack>
        ) : (
          <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => ops.run()}>
            Run
          </Button>
        )}
      </Stack>
      {missingNames.length > 0 && (
        <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
          Fill in{' '}
          {missingNames.map((n) => action.params.find((x) => x.name === n)!.label).join(', ')} to
          run this pivot.
        </Typography>
      )}

      <Popover
        open={!!pop}
        anchorEl={pop?.el}
        onClose={() => setPop(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        {popParam && (
          <Box
            sx={{ p: 2, width: 340 }}
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              setPop(null);
            }}
          >
            <ParamField
              param={popParam}
              values={tab.values}
              value={tab.values[popParam.name]}
              onChange={(v) => ops.setValue(popParam.name, v)}
              error={tab.errors[popParam.name]}
              missing={tab.missing[popParam.name]}
              autoFocus
            />
            <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 1 }}>
              <Button size="small" type="submit">
                Done
              </Button>
            </Stack>
          </Box>
        )}
      </Popover>

      <Tabs
        value={view}
        onChange={(_, v: View) => setPick({ key, view: v })}
        sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, textTransform: 'none' } }}
      >
        {editors.length > 0 && (
          <MuiTab
            value="query"
            label={
              editors.some((x) => tab.errors[x.name]) ? (
                <Box component="span" sx={{ color: 'error.main' }}>
                  Query •
                </Box>
              ) : (
                'Query'
              )
            }
          />
        )}
        <MuiTab
          value="results"
          label={shown?.rows ? `Results · ${shown.rows.length.toLocaleString()}` : 'Results'}
        />
        <MuiTab
          value="run"
          iconPosition="start"
          icon={
            tab.startError ? (
              <ErrorIcon fontSize="small" color="error" />
            ) : run ? (
              STATUS[run.status].icon
            ) : undefined
          }
          label={
            run && !tab.startError
              ? `Run · ${run.status === 'running' ? fmtElapsed(now - run.startedAt) : fmtDuration(run.finishedAt! - run.startedAt)}`
              : 'Run'
          }
        />
      </Tabs>
      <Divider sx={{ mb: 1.5 }} />

      {view === 'query' &&
        editors.map((x) => (
          <QueryEditor
            key={x.name}
            tab={tab}
            param={x}
            value={tab.values[x.name]}
            onChange={(v) => ops.setValue(x.name, v)}
            height="calc(100vh - 300px)"
            error={tab.errors[x.name]}
          />
        ))}
      {view === 'results' &&
        (shown ? (
          <>
            {shown !== run && run && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 0.5 }}
              >
                {running
                  ? 'Running… '
                  : `The latest run ${STATUS[run.status].label.toLowerCase()}. `}
                Showing the run from {fmtClock(shown.startedAt)}.
              </Typography>
            )}
            <MockGrid run={shown} dim={running} onPivot={ops.pivot} height="calc(100vh - 290px)" />
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {running ? 'Results appear when the run finishes.' : 'No results yet.'}
          </Typography>
        ))}
      {view === 'run' &&
        (tab.startError ? (
          <Alert severity="error">
            <AlertTitle>Couldn't start the run</AlertTitle>
            {tab.startError}
          </Alert>
        ) : run ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
              gap: 3,
              maxWidth: 1000,
            }}
          >
            <Box>
              {run.status === 'timedOut' && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Stopped at the instance's run timeout. Narrow the params and run again.
                </Alert>
              )}
              {run.status === 'cancelled' && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  You cancelled this run.
                </Alert>
              )}
              {run.status === 'running' && <LinearProgress sx={{ mb: 2 }} />}
              <RunInfo run={run} action={action} />
            </Box>
            <Box />
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Not run yet.
          </Typography>
        ))}
    </Box>
  );
}
