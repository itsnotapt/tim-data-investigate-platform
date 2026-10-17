// PROTOTYPE (wayfinder "Saved params"): throwaway, in-memory only, never merged.
// Question: how do analysts create, share and manage saved params, including saved
// queries that become pivots? Actions are admin-authored; saved params are analyst data.
// Open at #/prototype/saved-params; ◀ ▶ (or arrow keys) switch variants.
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

/** One pivot input: an unfixed action param, or a `declare query_parameters` name in saved KQL. */
interface Input {
  name: string;
  type: string;
  columns: string[];
  many: boolean;
  /** 'param' = an action param left open; 'query' = a Kusto query parameter bound server-side. */
  via: 'param' | 'query';
}
interface Saved {
  id: string;
  name: string;
  menu: string;
  actionKey: string;
  /** Fixed values; params missing here stay open (form or pivot). */
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
 * Suggests query parameters from the query text. Only a suggestion: the saved item's declared
 * inputs are the source of truth, and TIM builds the backend binding from them.
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

/** What the hook sends for one clicked row (or the selected rows, for `many`). */
function backendRequest(s: Saved, rows: Record<string, string>[]): string {
  const valueOf = (i: Input) => {
    const col = (r: Record<string, string>) => r[i.columns.find((c) => c in r) ?? ''];
    return i.many ? [...new Set(rows.map(col).filter(Boolean))] : (col(rows[0]!) ?? '');
  };
  const qp = s.inputs.filter((i) => i.via === 'query');
  if (s.actionKey === 'run_kql') {
    const kql = s.values.kql ?? '';
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
  return `Action ${s.actionKey} run with params:\n${JSON.stringify({ ...s.values, ...params }, null, 1)}`;
}

/** Derives pivot inputs for a save: open action params that have from_columns, plus KQL query parameters. */
function deriveInputs(
  action: ActionDef,
  values: Record<string, string>,
  prev: Input[] = [],
): Input[] {
  const old = (n: string) => prev.find((i) => i.name === n);
  const fromParams: Input[] = action.params
    .filter((p) => p.fromColumns && !values[p.name])
    .map(
      (p) =>
        old(p.name) ?? {
          name: p.name,
          type: p.kind,
          columns: p.fromColumns!,
          many: !!p.many,
          via: 'param',
        },
    );
  const fromQuery: Input[] = suggestQueryParams(values).map(
    (q) =>
      old(q.name) ?? {
        name: q.name,
        type: q.type,
        // Suggest a same-named result column; otherwise the analyst maps it.
        columns: COLUMNS.includes(q.name) ? [q.name] : [],
        many: false,
        via: 'query',
      },
  );
  // Keep query parameters the analyst declared by hand (e.g. KQL without a declare statement).
  const kept = prev.filter((i) => i.via === 'query' && !fromQuery.some((q) => q.name === i.name));
  return [...fromParams, ...fromQuery, ...kept];
}

const isPivot = (s: Saved) => s.inputs.length > 0 && s.inputs.every((i) => i.columns.length > 0);
const pivotMatches = (inputs: Input[], cols: string[]) =>
  inputs.every((i) => i.columns.some((c) => cols.includes(c)));
const visibleTo = (s: Saved, who: string) =>
  (s.owner === who || s.shared) && !s.hiddenBy.includes(who);

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
      lines.push(
        `  - name: ${i.name}`,
        `    kind: ${i.type}`,
        `    from_columns: [${i.columns.join(', ')}]`,
      );
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
      kql: 'DeviceProcessEvents\n| where FileName == ProcessName\n| summarize count() by InitiatingProcessFileName\n| where count_ < 5',
      idColumn: '',
    },
    inputs: [
      {
        name: 'ProcessName',
        type: 'string',
        columns: ['ProcessName', 'FileName'],
        many: false,
        via: 'query',
      },
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
    inputs: [
      {
        name: 'user',
        type: 'string',
        columns: ['AccountUpn', 'UserPrincipalName', 'Upn'],
        many: false,
        via: 'param',
      },
    ],
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
    inputs: [
      {
        name: 'users',
        type: 'string',
        columns: ['AccountUpn', 'UserPrincipalName'],
        many: true,
        via: 'query',
      },
    ],
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
  values: Record<string, string>;
  /** Snapshot origin: later edits to the saved item don't change the tab. */
  fromSaved?: string;
  /** Snapshot of the saved item's pivot inputs, so "Save as…" keeps the column mapping. */
  inputs?: Input[];
  /** Values filled from the clicked row for those inputs; never saved as fixed values. */
  bound?: Record<string, string>;
  via: string;
}

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
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: 1,
      actionKey: 'run_kql',
      values: Object.fromEntries(
        actionByKey('run_kql').params.map((p) => [p.name, p.default ?? '']),
      ),
      via: 'New → Run KQL',
    },
  ]);
  const [active, setActive] = useState(1);
  const [log, setLog] = useState<string[]>(['start']);
  const [showLibrary, setShowLibrary] = useState(false);
  const say = (s: string) => setLog((l) => [s, ...l].slice(0, 8));

  const tab = tabs.find((t) => t.id === active) ?? tabs[0]!;
  const mine = saved.filter((s) => s.owner === who);
  const visible = saved.filter((s) => visibleTo(s, who));

  const openTab = (
    actionKey: string,
    values: Record<string, string>,
    via: string,
    origin: Partial<Tab> = {},
  ) => {
    const id = Math.max(0, ...tabs.map((t) => t.id)) + 1;
    setTabs((ts) => [...ts, { ...origin, id, actionKey, values: { ...values }, via }]);
    setActive(id);
    say(`open tab ${id} (${via})`);
  };
  const openSaved = (s: Saved, extra: Record<string, string> = {}, via = `New → ${s.name}`) => {
    const a = actionByKey(s.actionKey);
    const values = {
      ...Object.fromEntries(a.params.map((p) => [p.name, p.default ?? ''])),
      ...s.values,
    };
    openTab(s.actionKey, values, via, { fromSaved: s.id, inputs: s.inputs, bound: extra });
  };
  const updateTab = (values: Record<string, string>) =>
    setTabs((ts) => ts.map((t) => (t.id === tab.id ? { ...t, values } : t)));
  const upsert = (s: Saved) => {
    setSaved((all) =>
      all.some((x) => x.id === s.id) ? all.map((x) => (x.id === s.id ? s : x)) : [...all, s],
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
  const duplicate = (s: Saved) => {
    upsert({
      ...s,
      id: `s${Date.now()}`,
      name: `${s.name} (copy)`,
      owner: who,
      shared: false,
      hiddenBy: [],
      updated: Date.now(),
    });
  };
  const fromTab = (): Saved => {
    const a = actionByKey(tab.actionKey);
    const origin = tab.fromSaved ? saved.find((s) => s.id === tab.fromSaved) : undefined;
    const existing = origin?.owner === who ? origin : undefined;
    // Non-empty values are fixed, except params the origin fills from columns; empty ones stay open.
    const open = new Set((tab.inputs ?? []).map((i) => i.name));
    const values = Object.fromEntries(
      Object.entries(tab.values).filter(([k, v]) => v && !open.has(k)),
    );
    return {
      id: existing?.id ?? `s${Date.now()}`,
      name:
        existing?.name ??
        (origin
          ? `${origin.name} (copy)`
          : a.key === 'run_kql'
            ? 'Untitled query'
            : `${a.name} (saved)`),
      menu: existing?.menu ?? origin?.menu ?? a.menu,
      actionKey: a.key,
      values,
      inputs: deriveInputs(a, values, tab.inputs),
      owner: who,
      shared: existing?.shared ?? false,
      hiddenBy: [],
      updated: Date.now(),
    };
  };

  // Right-click on a grid row: admin actions and saved pivots whose inputs match the grid's columns.
  const pivotMenu = (row: Record<string, string>) => {
    const actions = ACTIONS.filter(
      (a) => a.params.some((p) => p.fromColumns) && pivotMatches(deriveInputs(a, {}), COLUMNS),
    );
    const pivots = visible.filter((s) => isPivot(s) && pivotMatches(s.inputs, COLUMNS));
    const resolve = (inputs: Input[]) =>
      Object.fromEntries(inputs.map((i) => [i.name, row[i.columns.find((c) => c in row)!] ?? '']));
    return { actions, pivots, resolve };
  };

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
  openTab: (k: string, v: Record<string, string>, via: string, origin?: Partial<Tab>) => void;
  openSaved: (s: Saved, extra?: Record<string, string>, via?: string) => void;
  updateTab: (v: Record<string, string>) => void;
  upsert: (s: Saved) => void;
  remove: (s: Saved) => void;
  hide: (s: Saved) => void;
  duplicate: (s: Saved) => void;
  fromTab: () => Saved;
  pivotMenu: (row: Record<string, string>) => {
    actions: ActionDef[];
    pivots: Saved[];
    resolve: (i: Input[]) => Record<string, string>;
  };
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
              p.openTab(
                a.key,
                Object.fromEntries(a.params.map((x) => [x.name, x.default ?? ''])),
                `New → ${a.name}`,
              );
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

// ---------------------------------------------------------------- tab

function TabView(p: Common & { variant: string }) {
  const a = actionByKey(p.tab.actionKey);
  const [saving, setSaving] = useState<Saved | null>(null);
  // Start from the saved item's snapshot when the tab came from one.
  const [pins, setPins] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      (p.tab.inputs ?? []).filter((i) => i.via === 'param').map((i) => [i.name, i.columns]),
    ),
  );
  const [quickName, setQuickName] = useState('');
  const [quickShared, setQuickShared] = useState(false);
  const [declared, setDeclared] = useState<Input[]>(() =>
    (p.tab.inputs ?? []).filter((i) => i.via === 'query'),
  );
  // B: query parameters suggested from the text plus any declared by hand.
  const qp = deriveInputs(a, p.tab.values, declared).filter((i) => i.via === 'query');
  const origin = p.tab.fromSaved ? p.saved.find((s) => s.id === p.tab.fromSaved) : undefined;

  const field = (param: ParamDef) => {
    const pinned = pins[param.name];
    const input = pinned ? (
      <TextField
        size="small"
        fullWidth
        label={`${param.label} ← from column`}
        value={pinned.join(', ')}
        onChange={(e) => setPins({ ...pins, [param.name]: e.target.value.split(/,\s*/) })}
        helperText="Pivot input: filled from the clicked row"
      />
    ) : param.kind === 'choice' || param.kind === 'connection' ? (
      <TextField
        select
        size="small"
        fullWidth
        label={param.label}
        value={p.tab.values[param.name] ?? ''}
        onChange={(e) => p.updateTab({ ...p.tab.values, [param.name]: e.target.value })}
      >
        {param.choices!.map((c) => (
          <MenuItem key={c} value={c}>
            {c}
          </MenuItem>
        ))}
      </TextField>
    ) : (
      <TextField
        size="small"
        fullWidth
        multiline={param.kind === 'kql' || param.kind === 'sql'}
        minRows={param.kind === 'kql' || param.kind === 'sql' ? 5 : undefined}
        label={param.label}
        value={p.tab.values[param.name] ?? ''}
        onChange={(e) => p.updateTab({ ...p.tab.values, [param.name]: e.target.value })}
        slotProps={{
          htmlInput: {
            style:
              param.kind === 'kql' || param.kind === 'sql'
                ? { fontFamily: 'monospace' }
                : undefined,
          },
        }}
      />
    );
    return (
      <Stack key={param.name} direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
        {input}
        {p.variant === 'B' && param.fromColumns && (
          <Tooltip title={pinned ? 'Unpin: fixed value' : 'Pin: fill from a column when pivoting'}>
            <IconButton
              onClick={() =>
                setPins((x) =>
                  pinned ? omit(x, param.name) : { ...x, [param.name]: param.fromColumns! },
                )
              }
            >
              {pinned ? <PushPinIcon /> : <PushPinOutlinedIcon />}
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    );
  };

  const quickSave = () => {
    const base = p.fromTab();
    const values = Object.fromEntries(Object.entries(base.values).filter(([k]) => !pins[k]));
    const inputs = [
      ...deriveInputs(a, values, base.inputs)
        .filter((i) => i.via === 'param')
        .map((i) => (pins[i.name] ? { ...i, columns: pins[i.name]! } : i)),
      ...qp,
    ];
    p.upsert({ ...base, values, inputs, name: quickName || base.name, shared: quickShared });
  };

  return (
    <Stack sx={{ gap: 1.5, maxWidth: 900 }}>
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
              const s = p.fromTab();
              p.upsert(s);
              p.say('saved privately; name, sharing and pivot inputs are edited in the library');
            }}
          >
            Save to library
          </Button>
        )}
        <Button
          variant="outlined"
          onClick={() => p.say(`run tab (${JSON.stringify(p.tab.values).slice(0, 60)}…)`)}
        >
          Run
        </Button>
      </Stack>

      {a.params.map(field)}

      {p.tab.bound && Object.keys(p.tab.bound).length > 0 && (
        <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="caption">
            Filled from the clicked row (not part of the saved item):
          </Typography>
          {Object.entries(p.tab.bound).map(([k, v]) => (
            <Chip key={k} size="small" color="primary" variant="outlined" label={`${k} = ${v}`} />
          ))}
        </Stack>
      )}

      {p.variant === 'B' && hasQuery(a) && (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}>
          <Typography variant="subtitle2">
            Query parameters (declared here, bound server-side, never spliced)
          </Typography>
          <QueryParamsEditor inputs={qp} onChange={setDeclared} />
        </Box>
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
          <Button startIcon={<StarBorderIcon />} onClick={quickSave}>
            Save
          </Button>
        </Stack>
      )}

      {p.variant !== 'B' && hasQuery(a) && (
        <Typography variant="caption" color="text.secondary">
          {a.key === 'run_sql'
            ? 'Use :name placeholders'
            : 'Reference a parameter by name (TIM adds the declare statement)'}
          ; saving lets you declare each one and map it to columns, which makes the saved query a
          pivot.
        </Typography>
      )}

      <MockGrid {...p} />

      {saving && (
        <Dialog open onClose={() => setSaving(null)} maxWidth="md" fullWidth>
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

/** Declares query parameters: name, type, the columns a pivot fills it from, and one row vs all selected rows. */
function QueryParamsEditor({
  inputs,
  onChange,
}: {
  inputs: Input[];
  onChange: (inputs: Input[]) => void;
}) {
  const [name, setName] = useState('');
  const set = (n: string, patch: Partial<Input>) =>
    onChange(inputs.map((i) => (i.name === n ? { ...i, ...patch } : i)));
  return (
    <Box>
      {inputs.map((i) => (
        <Stack key={i.name} direction="row" sx={{ alignItems: 'center', gap: 1, mt: 1 }}>
          <Chip
            size="small"
            color="primary"
            label={i.name}
            onDelete={() => onChange(inputs.filter((x) => x.name !== i.name))}
          />
          <TextField
            select
            size="small"
            value={i.type}
            onChange={(e) => set(i.name, { type: e.target.value })}
            sx={{ width: 110 }}
          >
            {['string', 'long', 'real', 'datetime', 'bool'].map((t) => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="From columns (first match wins)"
            value={i.columns.join(', ')}
            onChange={(e) => set(i.name, { columns: e.target.value.split(/,\s*/).filter(Boolean) })}
            sx={{ flex: 1 }}
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={i.many}
                onChange={(e) => set(i.name, { many: e.target.checked })}
              />
            }
            label="All selected rows"
          />
        </Stack>
      ))}
      <Stack direction="row" sx={{ gap: 1, mt: 1 }}>
        <TextField
          size="small"
          placeholder="Parameter name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          disabled={!/^[A-Za-z_]\w*$/.test(name) || inputs.some((i) => i.name === name)}
          onClick={() => {
            onChange([
              ...inputs,
              {
                name,
                type: 'string',
                columns: COLUMNS.includes(name) ? [name] : [],
                many: false,
                via: 'query',
              },
            ]);
            setName('');
          }}
        >
          Add parameter
        </Button>
      </Stack>
    </Box>
  );
}

function omit<T>(o: Record<string, T>, k: string): Record<string, T> {
  return Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));
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
  const setInput = (n: string, patch: Partial<Input>) =>
    setS({ ...s, inputs: s.inputs.map((i) => (i.name === n ? { ...i, ...patch } : i)) });
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
        <Typography variant="subtitle2">Fixed values ({a.name})</Typography>
        <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {Object.entries(s.values)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n')}
        </pre>
      </Box>
      <Box>
        <Typography variant="subtitle2">
          Pivot inputs{' '}
          {isPivot(s)
            ? '(offered in the right-click menu)'
            : '(map every input to a column to make this a pivot)'}
        </Typography>
        {s.inputs.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            None: a bookmark that opens in the New menu. Add{' '}
            <code>declare query_parameters(...)</code> to the KQL to pivot.
          </Typography>
        )}
        {s.inputs
          .filter((i) => i.via === 'param')
          .map((i) => (
            <Stack key={i.name} direction="row" sx={{ alignItems: 'center', gap: 1, mt: 1 }}>
              <Chip size="small" label={`${i.name}: ${i.type} (action param)`} />
              <TextField
                size="small"
                label="From columns (first match wins)"
                value={i.columns.join(', ')}
                onChange={(e) =>
                  setInput(i.name, { columns: e.target.value.split(/,\s*/).filter(Boolean) })
                }
                sx={{ flex: 1 }}
              />
            </Stack>
          ))}
        {hasQuery(a) && (
          <QueryParamsEditor
            inputs={s.inputs.filter((i) => i.via === 'query')}
            onChange={(qp) =>
              setS({ ...s, inputs: [...s.inputs.filter((i) => i.via === 'param'), ...qp] })
            }
          />
        )}
      </Box>
      <Box>
        <Typography variant="subtitle2">
          What the backend receives when pivoting from the first mock row (or all rows for "all
          selected")
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
          {backendRequest(s, ROWS)}
        </pre>
      </Box>
    </Stack>
  );
  const actions = (
    <>
      {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      <Button variant="contained" onClick={() => onSave({ ...s, updated: Date.now() })}>
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
                onClick={() => setSel(s.id)}
                sx={{ cursor: 'pointer', bgcolor: s.id === sel ? 'action.selected' : undefined }}
              >
                <td>
                  {s.name} {s.shared && <Chip size="small" label="shared" />}
                </td>
                <td>{actionByKey(s.actionKey).name}</td>
                <td>{s.owner === p.who ? 'me' : s.owner.split('@')[0]}</td>
                <td>{isPivot(s) ? s.inputs.map((i) => i.columns[0]).join(', ') : '—'}</td>
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
  const m = menu ? p.pivotMenu(menu.row) : null;
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
            () => {
              const inputs = deriveInputs(a, {});
              p.openTab(
                a.key,
                {
                  ...Object.fromEntries(a.params.map((x) => [x.name, x.default ?? ''])),
                  ...m.resolve(inputs),
                },
                `pivot → ${a.name}`,
              );
            },
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
            () => p.openSaved(s, m.resolve(s.inputs), `pivot → ${s.name}`),
            s.id,
          ),
        )}
      </Menu>
    </Box>
  );
}
