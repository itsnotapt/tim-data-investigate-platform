// PROTOTYPE (wayfinder "Tagging in the grid"): throwaway, in-memory only, never merged.
// Question: what do tagging and its history look like in the grid? The right-click menu (labels,
// tagging, commenting, pivots and sinks in one menu), keyboard quick actions and whether analysts
// choose their own, the tagging dialog with the "After tagging, run…" sink picker, the per-`id`
// timeline of label changes and comments, and how a row shows its label, tags and comments.
// Three variants on one route, switchable with ?variant=A|B|C, on a real AG Grid. There's no API:
// annotations live in memory, PATCH /api/annotations is applied locally and echoed in the bottom
// bar, and pivots and sinks only toast. The bottom bar installs or removes the mock sinks, makes the
// next sink fail, toggles remembering the last sink, and simulates a teammate's change arriving
// through the change feed.
// Run with `npm run prototype:grid-tagging`.
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  GlobalStyles,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  MenuItem,
  Paper,
  Popover,
  Stack,
  Tab as MuiTab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import ChatBubbleOutlineOutlined from '@mui/icons-material/ChatBubbleOutlineOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import CloseIcon from '@mui/icons-material/Close';
import DoNotDisturbOnOutlined from '@mui/icons-material/DoNotDisturbOnOutlined';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import HistoryIcon from '@mui/icons-material/History';
import LocalOfferOutlined from '@mui/icons-material/LocalOfferOutlined';
import SearchIcon from '@mui/icons-material/Search';
import SendIcon from '@mui/icons-material/Send';
import TuneIcon from '@mui/icons-material/Tune';
import WarningAmber from '@mui/icons-material/WarningAmber';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import {
  HighlightChangesModule,
  ModuleRegistry,
  themeBalham,
  type CellClickedEvent,
  type ColDef,
  type DefaultMenuItem,
  type GetContextMenuItemsParams,
  type GridApi,
  type IRowNode,
  type MenuItemDef,
  type RowClassRules,
  type SelectionColumnDef,
} from 'ag-grid-community';
import { initAgGrid } from '../grid/agGridSetup';
import { SkullIcon } from '../grid/SkullIcon';
import { PrototypeSwitcher, usePrototypeVariant } from '../../components/PrototypeSwitcher';

initAgGrid({});
// Flashing rows a teammate just changed.
ModuleRegistry.registerModules([HighlightChangesModule]);

// ---------------------------------------------------------------- mock instance (GET /api/instance)

interface LabelDef {
  key: string;
  name: string;
  /** Row fill and stripe; the first three are today's theme colours. */
  fill: string;
  stripe: string;
  symbol?: { Icon: ComponentType<SvgIconProps>; viewBox?: string; aspect?: number };
}

/** From the labels file. `needs-triage` is stored on one `id` but no longer configured. */
const LABELS: LabelDef[] = [
  {
    key: 'malicious',
    name: 'Malicious',
    fill: 'var(--mui-palette-determination-malicious)',
    stripe: 'var(--mui-palette-stripe-malicious)',
    symbol: { Icon: SkullIcon, viewBox: '80 -880 800 800' },
  },
  {
    key: 'suspicious',
    name: 'Suspicious',
    fill: 'var(--mui-palette-determination-suspicious)',
    stripe: 'var(--mui-palette-stripe-suspicious)',
    symbol: { Icon: WarningAmber, viewBox: '1 2 22 19', aspect: 22 / 19 },
  },
  {
    key: 'benign',
    name: 'Benign',
    fill: 'var(--mui-palette-determination-benign)',
    stripe: 'var(--mui-palette-stripe-benign)',
    symbol: { Icon: CheckCircleOutlined, viewBox: '2 2 20 20' },
  },
  {
    key: 'false-positive',
    name: 'False positive',
    fill: 'rgba(100,116,139,.28)',
    stripe: '#64748b',
    symbol: { Icon: DoNotDisturbOnOutlined, viewBox: '2 2 20 20' },
  },
  {
    key: 'escalated',
    name: 'Escalated',
    fill: 'rgba(124,58,237,.22)',
    stripe: '#7c3aed',
    symbol: { Icon: FlagOutlined, viewBox: '4 3 16 18', aspect: 16 / 18 },
  },
];
const UNKNOWN_FILL = 'rgba(148,163,184,.18)';
const UNKNOWN_STRIPE = '#94a3b8';
const labelOf = (key: string): LabelDef =>
  LABELS.find((l) => l.key === key) ?? {
    key,
    name: key,
    fill: UNKNOWN_FILL,
    stripe: UNKNOWN_STRIPE,
  };

interface SinkDef {
  key: string;
  name: string;
  menuPath: string;
}
const SINKS: SinkDef[] = [
  { key: 'save-kusto', name: 'Save event to Kusto', menuPath: 'Save' },
  { key: 'save-snowflake', name: 'Save event to Snowflake', menuPath: 'Save' },
  { key: 'sentinel-incident', name: 'Open Sentinel incident', menuPath: 'Send' },
];

interface PivotDef {
  key: string;
  name: string;
  menuPath: string;
  description: string;
  columns: string[];
  rows: 'row' | 'rows';
}
const PIVOTS: PivotDef[] = [
  [
    'device-timeline',
    'Device timeline',
    'Devices / Defender',
    'Every event on the device around the row',
    ['DeviceName'],
    'rows',
  ],
  [
    'process-events',
    'Process events',
    'Devices / Defender',
    'Process creations on the devices',
    ['DeviceName'],
    'rows',
  ],
  [
    'network-events',
    'Network connections',
    'Devices / Defender',
    'Outbound connections from the devices',
    ['DeviceName'],
    'rows',
  ],
  [
    'compliance',
    'Device compliance',
    'Devices / Intune',
    'Compliance state and owner',
    ['DeviceName'],
    'rows',
  ],
  [
    'signins',
    'Sign-ins',
    'Identity / Entra',
    'Interactive and non-interactive sign-ins',
    ['AccountUpn'],
    'rows',
  ],
  [
    'risky-users',
    'Risky users',
    'Identity / Entra',
    'Risk level and detections for the users',
    ['AccountUpn'],
    'rows',
  ],
  [
    'mail-sender',
    'Mail by sender',
    'Identity / Exchange',
    'Mail sent by the users in the last 7 days',
    ['AccountUpn'],
    'rows',
  ],
  [
    'okta',
    'Okta sessions',
    'Identity / Okta (Snowflake)',
    'Okta sessions for the users',
    ['AccountUpn'],
    'rows',
  ],
  [
    'file-prevalence',
    'File prevalence',
    'Files / Defender',
    'Devices that have seen the hashes',
    ['SHA256'],
    'rows',
  ],
  [
    'vt',
    'VirusTotal lookup',
    'Files / VirusTotal',
    'One hash, the VirusTotal report',
    ['SHA256'],
    'row',
  ],
  [
    'fw',
    'Connections to IP',
    'Network / Firewall',
    'Firewall sessions to the IPs',
    ['RemoteIP'],
    'rows',
  ],
  [
    'proxy',
    'Web requests to IP',
    'Network / Proxy',
    'Proxy requests to the IPs',
    ['RemoteIP'],
    'rows',
  ],
  [
    'ip-rep',
    'IP reputation',
    'Network / Threat intel',
    'One IP, its reputation and history',
    ['RemoteIP'],
    'row',
  ],
  [
    'cloudtrail',
    'CloudTrail by role',
    'Cloud / AWS',
    'Needs RoleArn, which this grid lacks',
    ['RoleArn'],
    'rows',
  ],
].map(([key, name, menuPath, description, columns, rows]) => ({
  key: key as string,
  name: name as string,
  menuPath: menuPath as string,
  description: description as string,
  columns: columns as string[],
  rows: rows as 'row' | 'rows',
}));

const ME = 'you@contoso.com';
const POPULAR_TAGS = [
  'IR-2291',
  'lateral-movement',
  'known-FP',
  'vip',
  'sandbox-detonated',
  'phish-campaign-0412',
  'test-device',
  'needs-owner',
];

// ---------------------------------------------------------------- mock result

interface Row {
  /** Ordinal, the grid row id (`_row`). */
  _row: number;
  id: string | null;
  Timestamp: string;
  AlertTitle: string;
  Severity: string;
  DeviceName: string;
  AccountUpn: string;
  FileName: string;
  SHA256: string;
  RemoteIP: string;
  [k: string]: string | number | null;
}
const COLUMNS = [
  'Timestamp',
  'id',
  'AlertTitle',
  'Severity',
  'DeviceName',
  'AccountUpn',
  'FileName',
  'SHA256',
  'RemoteIP',
];

function rng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

function makeRows(): Row[] {
  const r = rng(42);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
  const titles: [string, string][] = [
    ['Suspicious PowerShell download cradle', 'High'],
    ['Credential dumping via LSASS access', 'High'],
    ['Certutil used to decode payload', 'Medium'],
    ['Rundll32 spawned from Office', 'Medium'],
    ['Unusual sign-in location', 'Low'],
    ['Mshta executed remote HTA', 'High'],
    ['Scheduled task created by script', 'Low'],
  ];
  const devices = ['WS-0042', 'WS-0107', 'SRV-DB01', 'WS-0311', 'LAP-7781', 'SRV-APP03'];
  const users = [
    'alex@contoso.com',
    'sam@contoso.com',
    'priya@contoso.com',
    'jo@contoso.com',
    'kim@contoso.com',
  ];
  const files = [
    'powershell.exe',
    'certutil.exe',
    'rundll32.exe',
    'mshta.exe',
    'invoice_0412.docm',
    'svc.ps1',
  ];
  const ips = ['185.220.101.7', '45.153.160.2', '10.20.4.17', '91.219.236.18', '13.107.42.14'];
  const rows: Row[] = [];
  const start = Date.parse('2026-10-18T08:00:00Z');
  for (let a = 0; a < 46; a++) {
    const id = `da${hex(14)}_${Math.floor(r() * 9e8)}`;
    const [title, sev] = pick(titles);
    const device = pick(devices);
    const evidence = r() < 0.6 ? 1 : r() < 0.6 ? 2 : 3;
    for (let e = 0; e < evidence; e++) {
      rows.push({
        _row: 0,
        id,
        Timestamp: new Date(start - Math.floor(r() * 86_400_000)).toISOString(),
        AlertTitle: title,
        Severity: sev,
        DeviceName: device,
        AccountUpn: pick(users),
        FileName: pick(files),
        SHA256: hex(64),
        RemoteIP: pick(ips),
      });
    }
  }
  for (let k = 0; k < 4; k++) {
    rows.push({
      _row: 0,
      id: null,
      Timestamp: new Date(start - Math.floor(r() * 86_400_000)).toISOString(),
      AlertTitle: 'Evidence without an alert',
      Severity: 'Informational',
      DeviceName: pick(devices),
      AccountUpn: pick(users),
      FileName: pick(files),
      SHA256: hex(64),
      RemoteIP: pick(ips),
    });
  }
  rows.sort((x, y) => y.Timestamp.localeCompare(x.Timestamp));
  return rows.map((row, i) => ({ ...row, _row: i }));
}

// ---------------------------------------------------------------- annotations (Postgres, mocked)

interface LabelState {
  key: string;
  by: string;
  at: number;
}
interface TagState {
  tag: string;
  by: string;
  at: number;
}
interface CommentEntry {
  author: string;
  at: number;
  text: string;
}
interface Ann {
  label: LabelState | null;
  tags: TagState[];
  comments: CommentEntry[];
  /** `label_changes`, oldest first; fetched on demand in the real app. */
  labelHistory: { label: string | null; by: string; at: number }[];
}
type Store = Record<string, Ann>;
const EMPTY: Ann = { label: null, tags: [], comments: [], labelHistory: [] };

/** The body of `PATCH /api/annotations`, minus `ids` and `setTags`. */
interface Patch {
  label?: string | null;
  addTags?: string[];
  removeTags?: string[];
  comment?: string;
}

function applyPatch(store: Store, ids: string[], p: Patch, by: string, at: number): Store {
  const next = { ...store };
  for (const id of ids) {
    const cur = next[id] ?? EMPTY;
    let a = cur;
    if (p.label !== undefined && (a.label?.key ?? null) !== p.label) {
      a = {
        ...a,
        label: p.label ? { key: p.label, by, at } : null,
        labelHistory: [...a.labelHistory, { label: p.label, by, at }],
      };
    }
    if (p.addTags?.length) {
      const have = new Set(a.tags.map((t) => t.tag));
      const add = p.addTags.filter((t) => !have.has(t));
      if (add.length) a = { ...a, tags: [...a.tags, ...add.map((tag) => ({ tag, by, at }))] };
    }
    if (p.removeTags?.length) {
      const rm = new Set(p.removeTags);
      if (a.tags.some((t) => rm.has(t.tag)))
        a = { ...a, tags: a.tags.filter((t) => !rm.has(t.tag)) };
    }
    if (p.comment?.trim()) {
      a = { ...a, comments: [...a.comments, { author: by, at, text: p.comment.trim() }] };
    }
    if (a !== cur) next[id] = a;
  }
  return next;
}

function seedStore(rows: Row[]): Store {
  const ids = [...new Set(rows.map((r) => r.id).filter((x): x is string => !!x))];
  const t = Date.now();
  const h = 3_600_000;
  let s: Store = {};
  const at = (i: number, by: string, ago: number, p: Patch) => {
    s = applyPatch(s, [ids[i]!], p, by, t - ago);
  };
  at(1, 'priya@contoso.com', 26 * h, {
    label: 'suspicious',
    comment: 'Beaconing every 60 s to 185.220.101.7.',
  });
  at(1, 'priya@contoso.com', 26 * h, { addTags: ['lateral-movement'] });
  at(1, 'sam@contoso.com', 2 * h, { label: 'malicious', addTags: ['IR-2291'] });
  at(1, 'sam@contoso.com', 2 * h, { comment: 'Confirmed with IR, device isolated.' });
  at(4, 'jo@contoso.com', 5 * h, {
    label: 'benign',
    addTags: ['known-FP'],
    comment: 'Nightly backup job.',
  });
  at(6, 'alex@contoso.com', 70 * h, { label: 'needs-triage' });
  at(8, 'kim@contoso.com', 30 * h, { addTags: ['vip'] });
  at(10, 'priya@contoso.com', 8 * h, { comment: 'Asked the owner whether this was them.' });
  at(13, 'jo@contoso.com', 50 * h, { label: 'false-positive', addTags: ['test-device'] });
  at(15, 'sam@contoso.com', 3 * h, { label: 'escalated', addTags: ['IR-2291', 'vip'] });
  at(15, 'sam@contoso.com', 3 * h, { comment: 'Escalated to the IR on-call.' });
  at(18, 'priya@contoso.com', 1 * h, { label: 'suspicious' });
  at(21, 'jo@contoso.com', 20 * h, { label: 'malicious', addTags: ['phish-campaign-0412'] });
  at(22, 'jo@contoso.com', 20 * h, { label: 'malicious', addTags: ['phish-campaign-0412'] });
  return s;
}

// ---------------------------------------------------------------- helpers

const idsOf = (rows: readonly Row[]) => [
  ...new Set(rows.map((r) => r.id).filter((x): x is string => !!x)),
];

function ago(at: number): string {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
const who = (email: string) => (email === ME ? 'you' : email.split('@')[0]!);
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

function describe(p: Patch): string {
  const parts: string[] = [];
  if (p.label !== undefined) parts.push(p.label ? labelOf(p.label).name : 'label cleared');
  if (p.addTags?.length) parts.push(p.addTags.map((t) => `+${t}`).join(' '));
  if (p.removeTags?.length) parts.push(p.removeTags.map((t) => `−${t}`).join(' '));
  if (p.comment?.trim()) parts.push('comment');
  return parts.join(', ');
}

/** Tags on these `id`s and how many carry each. */
function tagCounts(anns: Ann[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of anns) for (const t of a.tags) m.set(t.tag, (m.get(t.tag) ?? 0) + 1);
  return m;
}

function labelMix(anns: Ann[]): string {
  const m = new Map<string, number>();
  for (const a of anns) {
    const k = a.label ? labelOf(a.label.key).name : 'no label';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([k, n]) => `${k} ${n}`).join(' · ');
}

interface TreeNode {
  name: string;
  children: TreeNode[];
  pivot?: PivotDef;
}
function pivotTree(pivots: PivotDef[]): TreeNode[] {
  const root: TreeNode = { name: '', children: [] };
  for (const p of pivots) {
    let node = root;
    for (const seg of p.menuPath.split(' / ')) {
      let child = node.children.find((c) => !c.pivot && c.name === seg);
      if (!child) node.children.push((child = { name: seg, children: [] }));
      node = child;
    }
    node.children.push({ name: p.name, children: [], pivot: p });
  }
  return root.children;
}
const availablePivots = () => PIVOTS.filter((p) => p.columns.every((c) => COLUMNS.includes(c)));

// ---------------------------------------------------------------- page context shared by variants

interface Ctx {
  rows: Row[];
  store: Store;
  /** Installed sinks; empty hides the picker and the menu entries. */
  sinks: SinkDef[];
  annotate: (targets: readonly Row[], patch: Patch, sink?: string | null) => void;
  runSink: (key: string, rows: readonly Row[]) => void;
  pivot: (key: string, rows: readonly Row[]) => void;
  recentPivots: string[];
  /** Initial value of the dialog's sink picker. */
  defaultSink: string;
  recentTags: string[];
  /** Ids a teammate just changed, to flash. */
  flash: { ids: string[]; n: number } | null;
}

interface Toast {
  key: number;
  text: ReactNode;
  severity: 'success' | 'info' | 'error';
  actions?: { label: string; run: () => void }[];
  sticky?: boolean;
}

// ---------------------------------------------------------------- small shared pieces

/** Focuses on mount, after MUI's focus trap has focused the dialog or popover itself. */
const focusLater = (el: HTMLElement | null) => {
  if (el) setTimeout(() => el.focus(), 60);
};

function LabelSymbol({ labelKey, size = 15 }: { labelKey: string; size?: number }) {
  const l = labelOf(labelKey);
  if (!l.symbol) return null;
  const { Icon, viewBox, aspect = 1 } = l.symbol;
  return (
    <Icon
      viewBox={viewBox}
      aria-label={l.name}
      sx={{ width: size * aspect, height: size, color: 'text.primary', display: 'block' }}
    />
  );
}

function Swatch({ labelKey, size = 10 }: { labelKey: string; size?: number }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '2px',
        bgcolor: labelOf(labelKey).stripe,
        flex: 'none',
      }}
    />
  );
}

/** AG Grid menu icons are HTML strings. */
const swatchHtml = (key: string) =>
  `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${labelOf(key).stripe}"></span>`;

function LabelChip({ labelKey, by, at }: { labelKey: string; by?: string; at?: number }) {
  const l = labelOf(labelKey);
  const known = LABELS.some((x) => x.key === labelKey);
  return (
    <Tooltip
      title={
        <>
          {known ? l.name : `${labelKey}: no longer a configured label`}
          {by && (
            <>
              <br />
              by {who(by)}, {at ? ago(at) : ''}
            </>
          )}
        </>
      }
    >
      <Chip
        size="small"
        icon={
          l.symbol ? (
            <Box sx={{ pl: 0.75 }}>{<LabelSymbol labelKey={labelKey} size={13} />}</Box>
          ) : undefined
        }
        label={l.name}
        sx={{
          height: 20,
          fontSize: 11,
          bgcolor: l.fill,
          borderLeft: `4px solid ${l.stripe}`,
          borderRadius: '4px',
          fontStyle: known ? undefined : 'italic',
        }}
      />
    </Tooltip>
  );
}

function TagChips({ tags, max = 99 }: { tags: TagState[]; max?: number }) {
  const shown = tags.slice(0, max);
  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{ overflow: 'hidden', alignItems: 'center', height: '100%' }}
    >
      {shown.map((t) => (
        <Tooltip key={t.tag} title={`added by ${who(t.by)}, ${ago(t.at)}`}>
          <Chip size="small" variant="outlined" label={t.tag} sx={{ height: 18, fontSize: 11 }} />
        </Tooltip>
      ))}
      {tags.length > max && (
        <Typography variant="caption" color="text.secondary">
          +{tags.length - max}
        </Typography>
      )}
    </Stack>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <Box
      component="kbd"
      sx={{
        font: '11px monospace',
        px: 0.5,
        border: 1,
        borderColor: 'divider',
        borderRadius: 0.5,
        color: 'text.secondary',
        ml: 'auto',
      }}
    >
      {children}
    </Box>
  );
}

function TargetsLine({ targets, rows }: { targets: readonly Row[]; rows: Row[] }) {
  const ids = idsOf(targets);
  const noId = targets.filter((r) => !r.id).length;
  const idSet = new Set(ids);
  const others = rows.filter((r) => r.id && idSet.has(r.id)).length - (targets.length - noId);
  return (
    <Typography variant="body2" color="text.secondary">
      {plural(targets.length, 'row')} · {plural(ids.length, 'id')}
      {others > 0 && ` · also changes ${plural(others, 'other row')} with the same id`}
      {noId > 0 && (
        <Box component="span" sx={{ color: 'warning.main' }}>
          {' '}
          · {plural(noId, 'row')} without an id {noId === 1 ? 'is' : 'are'} skipped
        </Box>
      )}
    </Typography>
  );
}

// ---------------------------------------------------------------- tag editor (dialog, panel, popover)

interface TagOption {
  tag: string;
  group: string;
}

/** Suggestions: tags on the selection, then the analyst's recent tags, then the instance's popular ones. */
function tagOptions(
  counts: Map<string, number>,
  recent: string[],
  taken: Set<string>,
): TagOption[] {
  const seen = new Set<string>();
  const out: TagOption[] = [];
  const push = (tag: string, group: string) => {
    if (seen.has(tag) || taken.has(tag)) return;
    seen.add(tag);
    out.push({ tag, group });
  };
  for (const t of counts.keys()) push(t, 'On these rows');
  for (const t of recent) push(t, 'Your recent tags');
  for (const t of POPULAR_TAGS) push(t, 'Most used');
  return out;
}

/**
 * The selection's tags as chips with how many `id`s carry each; × removes, clicking a partial tag
 * adds it to every `id`; the field adds new ones. Pending changes show until saved.
 */
function TagEditor({
  anns,
  add,
  remove,
  onChange,
  recent,
  autoFocus,
  inputRef,
  placeholder = 'Add a tag',
}: {
  anns: Ann[];
  add: string[];
  remove: string[];
  onChange: (add: string[], remove: string[]) => void;
  recent: string[];
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  placeholder?: string;
}) {
  const counts = tagCounts(anns);
  const total = anns.length;
  const [text, setText] = useState('');
  const all = [...new Set([...counts.keys(), ...add])];
  const taken = new Set(all.filter((t) => counts.get(t) === total || add.includes(t)));
  const options = tagOptions(counts, recent, taken);
  const addTag = (raw: string) => {
    const tag = raw.trim().slice(0, 100);
    if (!tag) return;
    onChange(
      [...new Set([...add, tag])],
      remove.filter((t) => t !== tag),
    );
    setText('');
  };
  return (
    <Box>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mb: all.length ? 1 : 0 }}>
        {all.map((tag) => {
          const n = counts.get(tag) ?? 0;
          const removed = remove.includes(tag);
          const added = add.includes(tag);
          const partial = !added && !removed && n < total;
          return (
            <Tooltip
              key={tag}
              title={
                removed
                  ? 'Will be removed: click to keep'
                  : added
                    ? n
                      ? `Will be added to the other ${total - n}`
                      : 'Will be added'
                    : partial
                      ? `On ${n} of ${total} ids: click to add to all`
                      : `On every selected id`
              }
            >
              <Chip
                size="small"
                label={partial ? `${tag} ${n}/${total}` : tag}
                color={added ? 'primary' : 'default'}
                variant={added ? 'filled' : 'outlined'}
                onClick={
                  removed
                    ? () =>
                        onChange(
                          add,
                          remove.filter((t) => t !== tag),
                        )
                    : partial
                      ? () => onChange([...add, tag], remove)
                      : undefined
                }
                onDelete={
                  removed
                    ? undefined
                    : () =>
                        added && n === 0
                          ? onChange(
                              add.filter((t) => t !== tag),
                              remove,
                            )
                          : onChange(
                              add.filter((t) => t !== tag),
                              [...remove, tag],
                            )
                }
                sx={{
                  textDecoration: removed ? 'line-through' : undefined,
                  opacity: removed ? 0.55 : 1,
                  borderStyle: partial ? 'dashed' : undefined,
                }}
              />
            </Tooltip>
          );
        })}
      </Stack>
      <Autocomplete<TagOption, false, false, true>
        freeSolo
        size="small"
        options={options}
        groupBy={(o) => o.group}
        getOptionLabel={(o) => (typeof o === 'string' ? o : o.tag)}
        inputValue={text}
        onInputChange={(_e, v, reason) => reason !== 'reset' && setText(v)}
        value={null}
        onChange={(_e, v) => v && addTag(typeof v === 'string' ? v : v.tag)}
        renderInput={(params) => (
          <TextField
            {...params}
            inputRef={autoFocus ? focusLater : inputRef}
            placeholder={placeholder}
            slotProps={{
              ...params.slotProps,
              input: {
                ...params.slotProps.input,
                startAdornment: (
                  <InputAdornment position="start">
                    <LocalOfferOutlined fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        )}
      />
    </Box>
  );
}

// ---------------------------------------------------------------- timeline

/** One `id`'s current state, then label changes and comments interleaved, newest first. */
function Timeline({
  id,
  ann,
  onComment,
  dense,
}: {
  id: string;
  ann: Ann;
  onComment?: (text: string) => void;
  dense?: boolean;
}) {
  const [text, setText] = useState('');
  type Entry = { at: number; by: string; node: ReactNode };
  const entries: Entry[] = [];
  ann.labelHistory.forEach((h, i) => {
    const prev = i > 0 ? ann.labelHistory[i - 1]!.label : null;
    entries.push({
      at: h.at,
      by: h.by,
      node: h.label ? (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{prev ? 'changed the label' : 'labelled'}</span>
          {prev && (
            <>
              <Box component="span" sx={{ textDecoration: 'line-through', opacity: 0.7 }}>
                {labelOf(prev).name}
              </Box>
              <span>→</span>
            </>
          )}
          <LabelChip labelKey={h.label} />
        </Stack>
      ) : (
        <span>
          cleared the label
          {prev && (
            <Box component="span" sx={{ opacity: 0.7 }}>
              {' '}
              ({labelOf(prev).name})
            </Box>
          )}
        </span>
      ),
    });
  });
  for (const c of ann.comments)
    entries.push({
      at: c.at,
      by: c.author,
      node: (
        <Box
          sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 1, py: 0.5, whiteSpace: 'pre-wrap' }}
        >
          {c.text}
        </Box>
      ),
    });
  entries.sort((a, b) => b.at - a.at);
  const submit = () => {
    if (!text.trim() || !onComment) return;
    onComment(text);
    setText('');
  };
  return (
    <Box sx={{ fontSize: 13 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
        {id}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', my: 0.75 }}>
        {ann.label ? (
          <>
            <LabelChip labelKey={ann.label.key} by={ann.label.by} at={ann.label.at} />
            <Typography variant="caption" color="text.secondary">
              by {who(ann.label.by)}, {ago(ann.label.at)}
            </Typography>
          </>
        ) : (
          <Typography variant="caption" color="text.secondary">
            No label
          </Typography>
        )}
      </Stack>
      {ann.tags.length > 0 && (
        <Box sx={{ mb: 1 }}>
          <TagChips tags={ann.tags} />
        </Box>
      )}
      {onComment && (
        <Box sx={{ mb: 1.5 }}>
          <TextField
            fullWidth
            multiline
            minRows={dense ? 1 : 2}
            size="small"
            placeholder="Add a comment (Ctrl+Enter)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
            }}
          />
          <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 0.5 }}>
            <Button size="small" disabled={!text.trim()} onClick={submit}>
              Comment
            </Button>
          </Stack>
        </Box>
      )}
      <Typography variant="overline" color="text.secondary">
        History
      </Typography>
      {entries.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No label changes or comments yet.
        </Typography>
      )}
      <Stack spacing={1.25} sx={{ mt: 0.5 }}>
        {entries.map((e, i) => (
          <Stack key={i} direction="row" spacing={1}>
            <Box
              sx={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                bgcolor: e.by === ME ? 'primary.main' : 'grey.500',
                color: 'common.white',
                fontSize: 11,
                display: 'grid',
                placeItems: 'center',
                flex: 'none',
              }}
            >
              {who(e.by)[0]!.toUpperCase()}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="caption" color="text.secondary">
                <b>{who(e.by)}</b> ·{' '}
                <Tooltip title={new Date(e.at).toISOString()}>
                  <span>{ago(e.at)}</span>
                </Tooltip>
              </Typography>
              <Box sx={{ mt: 0.25 }}>{e.node}</Box>
            </Box>
          </Stack>
        ))}
      </Stack>
      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 1.5 }}>
        Tags keep no history: a removed tag is gone.
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------------------- tagging dialog (A, and C's "Annotate…")

function AnnotateDialog({
  ctx,
  targets,
  focus,
  onClose,
}: {
  ctx: Ctx;
  targets: readonly Row[];
  focus: 'label' | 'tags' | 'comment';
  onClose: () => void;
}) {
  const ids = idsOf(targets);
  const anns = ids.map((id) => ctx.store[id] ?? EMPTY);
  const [label, setLabel] = useState<string>('keep');
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [sink, setSink] = useState(
    ctx.sinks.some((s) => s.key === ctx.defaultSink) ? ctx.defaultSink : '',
  );
  const patch: Patch = {
    ...(label === 'keep' ? {} : { label: label === 'clear' ? null : label }),
    ...(add.length ? { addTags: add } : {}),
    ...(remove.length ? { removeTags: remove } : {}),
    ...(comment.trim() ? { comment } : {}),
  };
  const empty = Object.keys(patch).length === 0;
  const sinkName = ctx.sinks.find((s) => s.key === sink)?.name;
  const save = () => {
    if (empty) return;
    ctx.annotate(targets, patch, sink || null);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
          },
        },
      }}
    >
      <DialogTitle sx={{ pb: 0.5 }}>Annotate {plural(ids.length, 'id')}</DialogTitle>
      <DialogContent>
        <TargetsLine targets={targets} rows={ctx.rows} />
        <Typography variant="overline" sx={{ display: 'block', mt: 2 }}>
          Label
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={label}
          onChange={(_e, v: string | null) => v && setLabel(v)}
          sx={{ flexWrap: 'wrap' }}
        >
          <ToggleButton
            value="keep"
            ref={focus === 'label' ? focusLater : undefined}
            sx={{ textTransform: 'none' }}
          >
            Keep
          </ToggleButton>
          {LABELS.map((l) => (
            <ToggleButton key={l.key} value={l.key} sx={{ gap: 0.75, textTransform: 'none' }}>
              <Swatch labelKey={l.key} />
              {l.name}
            </ToggleButton>
          ))}
          <ToggleButton value="clear" sx={{ textTransform: 'none' }}>
            Clear
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Now: {labelMix(anns)}
        </Typography>
        <Typography variant="overline" sx={{ display: 'block', mt: 2 }}>
          Tags
        </Typography>
        <TagEditor
          anns={anns}
          add={add}
          remove={remove}
          onChange={(a, r) => {
            setAdd(a);
            setRemove(r);
          }}
          recent={ctx.recentTags}
          autoFocus={focus === 'tags'}
        />
        <Typography variant="overline" sx={{ display: 'block', mt: 2 }}>
          Comment
        </Typography>
        <TextField
          fullWidth
          multiline
          minRows={2}
          size="small"
          inputRef={focus === 'comment' ? focusLater : undefined}
          placeholder={`Added to the thread of every id (${ids.length})`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        {ctx.sinks.length > 0 && (
          <TextField
            select
            fullWidth
            size="small"
            label="After tagging, run…"
            value={sink}
            onChange={(e) => setSink(e.target.value)}
            sx={{ mt: 3 }}
            helperText={
              sink
                ? `Starts after the annotations save, on the ${plural(targets.length, 'selected row')}`
                : 'Nothing runs'
            }
          >
            <MenuItem value="">
              <em>Nothing</em>
            </MenuItem>
            {ctx.sinks.map((s) => (
              <MenuItem key={s.key} value={s.key}>
                {s.menuPath} / {s.name}
                {s.key === ctx.defaultSink && (
                  <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                    sx={{ ml: 1 }}
                  >
                    last used
                  </Typography>
                )}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {empty ? 'Nothing changes yet.' : `${describe(patch)} on ${plural(ids.length, 'id')}`}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={empty} onClick={save}>
          {sinkName ? `Save and run ${sinkName}` : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------- grid

const gridTheme = themeBalham.withParams({
  backgroundColor: 'var(--mui-palette-background-paper)',
  foregroundColor: 'var(--mui-palette-text-primary)',
  textColor: 'var(--mui-palette-text-primary)',
  borderColor: 'var(--mui-palette-divider)',
  accentColor: 'var(--mui-palette-primary-main)',
  headerBackgroundColor: 'var(--mui-palette-grid-header)',
  chromeBackgroundColor: 'var(--mui-palette-grid-header)',
  oddRowBackgroundColor: 'var(--mui-palette-grid-oddRow)',
});

const labelClass = (key: string) =>
  LABELS.some((l) => l.key === key) ? `gt-label-${key}` : 'gt-label-unknown';

/** Fill (on `.gt-fill`) and stripe (on `.gt-stripe`) per label, as in today's grid.css. */
function LabelStyles() {
  const rules: Record<string, object> = {};
  for (const l of [...LABELS, { key: 'unknown', fill: UNKNOWN_FILL, stripe: UNKNOWN_STRIPE }]) {
    rules[`.gt-fill .gt-label-${l.key}`] = {
      '--ag-data-background-color': l.fill,
      '--ag-odd-row-background-color': l.fill,
    };
    rules[`.gt-stripe .gt-label-${l.key} .ag-cell.ag-column-first`] = {
      boxShadow: `inset 5px 0 0 ${l.stripe}`,
    };
  }
  rules['.gt-noid'] = { color: 'var(--mui-palette-text-secondary)' };
  return <GlobalStyles styles={rules} />;
}

type MenuItems = (DefaultMenuItem | MenuItemDef<Row>)[];

interface GridProps {
  ctx: Ctx;
  /** Annotation columns, after the selection column. */
  lead: ColDef<Row>[];
  selectionRenderer?: (p: CustomCellRendererProps<Row>) => ReactNode;
  fill: boolean;
  /** Native AG Grid menu; ignored with `onMenu`. */
  menu?: (targets: Row[], clicked: Row | null) => MenuItems;
  /** Own menu instead of AG Grid's. */
  onMenu?: (x: number, y: number, targets: Row[], clicked: Row) => void;
  onKey?: (key: string, targets: Row[]) => boolean;
  onSelect?: (rows: Row[]) => void;
  onFocusRow?: (row: Row | null) => void;
  onCellClicked?: (e: CellClickedEvent<Row>) => void;
  onApi?: (api: GridApi<Row>) => void;
  height?: string;
}

function Grid({
  ctx,
  lead,
  selectionRenderer,
  fill,
  menu,
  onMenu,
  onKey,
  onSelect,
  onFocusRow,
  onCellClicked,
  onApi,
  height = 'calc(100vh - 190px)',
}: GridProps) {
  const apiRef = useRef<GridApi<Row> | null>(null);
  const storeRef = useRef(ctx.store);
  const [context] = useState(() => ({ storeRef }));
  useEffect(() => {
    storeRef.current = ctx.store;
    apiRef.current?.redrawRows();
  }, [ctx.store, apiRef]);
  useEffect(() => {
    const api = apiRef.current;
    if (!ctx.flash || !api) return;
    const ids = new Set(ctx.flash.ids);
    const nodes: IRowNode<Row>[] = [];
    api.forEachNode((n) => n.data?.id && ids.has(n.data.id) && nodes.push(n));
    const t = setTimeout(
      () => api.flashCells({ rowNodes: nodes, flashDuration: 1500, fadeDuration: 1500 }),
      50,
    );
    if (nodes[0]) api.ensureNodeVisible(nodes[0], 'middle');
    return () => clearTimeout(t);
  }, [ctx.flash, apiRef]);

  const rowClassRules = useMemo<RowClassRules<Row>>(() => {
    const rules: RowClassRules<Row> = {
      'gt-noid': (p) => !p.data?.id,
    };
    for (const k of [...LABELS.map((l) => l.key), 'unknown'])
      rules[`gt-label-${k}`] = (p) => {
        const key = p.data?.id ? storeRef.current[p.data.id]?.label?.key : undefined;
        return !!key && labelClass(key) === `gt-label-${k}`;
      };
    return rules;
  }, []);

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      ...lead,
      ...COLUMNS.map<ColDef<Row>>((c) => ({
        field: c,
        width: c === 'AlertTitle' ? 260 : c === 'id' ? 200 : c === 'SHA256' ? 150 : 150,
        cellStyle: c === 'SHA256' || c === 'id' ? { fontFamily: 'monospace' } : undefined,
        valueFormatter: c === 'id' ? (p) => (p.value ? String(p.value) : '— no id') : undefined,
        tooltip:
          c === 'id' ? (p) => (p.value ? null : "No id: this row can't be tagged") : undefined,
      })),
    ],
    [lead],
  );

  const selectionColumnDef = useMemo<SelectionColumnDef>(
    () => ({
      pinned: 'left',
      width: selectionRenderer ? 58 : 34,
      minWidth: selectionRenderer ? 58 : 34,
      cellRenderer: selectionRenderer,
      resizable: false,
      sortable: false,
    }),
    [selectionRenderer],
  );

  /** Right-click on an unselected row selects just it; the targets are the selection. */
  const targetsFor = (api: GridApi<Row>, node: IRowNode<Row> | null | undefined): Row[] => {
    if (node && !node.isSelected()) node.setSelected(true, true);
    return api.getSelectedRows();
  };

  return (
    <div className={`gt-stripe${fill ? ' gt-fill' : ''}`} style={{ height }}>
      <AgGridReact<Row>
        theme={gridTheme}
        rowData={ctx.rows}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, resizable: true, filter: true }}
        getRowId={(p) => String(p.data._row)}
        context={context}
        rowClassRules={rowClassRules}
        rowSelection={{
          mode: 'multiRow',
          enableClickSelection: true,
          checkboxes: true,
          headerCheckbox: true,
        }}
        selectionColumnDef={selectionColumnDef}
        tooltipShowDelay={400}
        suppressContextMenu={!!onMenu}
        preventDefaultOnContextMenu={!!onMenu}
        getContextMenuItems={
          menu && !onMenu
            ? (p: GetContextMenuItemsParams<Row>) =>
                menu(targetsFor(p.api, p.node), p.node?.data ?? null)
            : undefined
        }
        onCellContextMenu={(e) => {
          if (!onMenu || !e.node.data) return;
          const ev = e.event as MouseEvent | null;
          onMenu(ev?.clientX ?? 0, ev?.clientY ?? 0, targetsFor(e.api, e.node), e.node.data);
        }}
        onCellKeyDown={(e) => {
          const ev = e.event as KeyboardEvent | null | undefined;
          if (!ev || !onKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
          const sel = e.api.getSelectedRows();
          const targets = sel.length ? sel : e.node.data ? [e.node.data] : [];
          if (onKey(ev.key.toLowerCase(), targets)) ev.preventDefault();
        }}
        onSelectionChanged={(e) => onSelect?.(e.api.getSelectedRows())}
        onCellFocused={(e) => {
          if (e.rowIndex === null || e.rowIndex === undefined) return;
          onFocusRow?.(e.api.getDisplayedRowAtIndex(e.rowIndex)?.data ?? null);
        }}
        onCellClicked={onCellClicked}
        onGridReady={(e) => {
          apiRef.current = e.api;
          onApi?.(e.api);
        }}
      />
    </div>
  );
}

/** Renderer helpers reading the annotations through the grid context. */
const annOf = (p: { data?: Row; context: { storeRef: { current: Store } } }): Ann | null =>
  p.data?.id ? (p.context.storeRef.current[p.data.id] ?? EMPTY) : null;

function SymbolCell(p: CustomCellRendererProps<Row>) {
  const a = annOf(p);
  if (!a?.label) return null;
  return (
    <Tooltip title={`${labelOf(a.label.key).name} · ${who(a.label.by)}, ${ago(a.label.at)}`}>
      <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <LabelSymbol labelKey={a.label.key} />
      </Box>
    </Tooltip>
  );
}

/** Native-menu pieces shared by A and B. */
function pivotMenuItems(ctx: Ctx, targets: Row[], recentFirst: boolean): MenuItemDef<Row>[] {
  const leaf = (p: PivotDef): MenuItemDef<Row> => {
    const tooMany = p.rows === 'row' && targets.length > 1;
    return {
      name: p.name,
      tooltip: tooMany ? 'Takes one row' : p.description,
      disabled: tooMany,
      action: () => ctx.pivot(p.key, targets),
    };
  };
  const toItems = (nodes: TreeNode[]): MenuItemDef<Row>[] =>
    nodes.map((n) => (n.pivot ? leaf(n.pivot) : { name: n.name, subMenu: toItems(n.children) }));
  const tree = toItems(pivotTree(availablePivots()));
  const recent = ctx.recentPivots
    .map((k) => PIVOTS.find((p) => p.key === k)!)
    .map((p) => ({ ...leaf(p), name: `${p.name}  (${p.menuPath})` }));
  return recentFirst && recent.length
    ? [{ name: 'Recent', disabled: true }, ...recent, { name: 'All', disabled: true }, ...tree]
    : tree;
}

function sinkMenuItems(ctx: Ctx, targets: Row[]): MenuItemDef<Row>[] {
  const paths = [...new Set(ctx.sinks.map((s) => s.menuPath))];
  return paths.map((path) => ({
    name: path,
    icon: '<span style="font-size:13px">➜</span>',
    subMenu: ctx.sinks
      .filter((s) => s.menuPath === path)
      .map((s) => ({
        name: s.name,
        tooltip: `Sends the ${plural(targets.length, 'selected row')}; no tab opens`,
        action: () => ctx.runSink(s.key, targets),
      })),
  }));
}

const noIdTooltip = "These rows have no id, so they can't be tagged";

// ---------------------------------------------------------------- variant A: menu + dialog + drawer
// Today's flow, evolved: AG Grid's own right-click menu with Label ▸ (keys 1–5, 0 clears), the
// full Annotate dialog for tags, comments and the sink picker, the row's fill, stripe and symbol
// for its label, Tags and Comments columns, and the timeline in a side drawer that follows the
// focused row. Quick actions are fixed: the labels in config order.

function VariantA({ ctx }: { ctx: Ctx }) {
  const [dialog, setDialog] = useState<{
    targets: Row[];
    focus: 'label' | 'tags' | 'comment';
  } | null>(null);
  const [drawer, setDrawer] = useState<Row | null>(null);
  const drawerOpen = useRef(false);
  useEffect(() => {
    drawerOpen.current = !!drawer;
  }, [drawer]);

  const lead = useMemo<ColDef<Row>[]>(
    () => [
      {
        colId: 'tags',
        headerName: 'Tags',
        width: 190,
        pinned: 'left',
        cellRenderer: (p: CustomCellRendererProps<Row>) => (
          <TagChips tags={annOf(p)?.tags ?? []} max={2} />
        ),
      },
      {
        colId: 'comments',
        headerName: '',
        width: 56,
        pinned: 'left',
        headerTooltip: 'Comments',
        cellRenderer: (p: CustomCellRendererProps<Row>) => {
          const c = annOf(p)?.comments ?? [];
          if (!c.length) return null;
          const last = c[c.length - 1]!;
          return (
            <Tooltip title={`${who(last.author)}, ${ago(last.at)}: ${last.text}`}>
              <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', height: '100%' }}>
                <ChatBubbleOutlineOutlined sx={{ fontSize: 14 }} />
                <span>{c.length}</span>
              </Stack>
            </Tooltip>
          );
        },
      },
    ],
    [],
  );

  const menu = (targets: Row[], clicked: Row | null): MenuItems => {
    const ids = idsOf(targets);
    const none = ids.length === 0;
    const anns = ids.map((id) => ctx.store[id] ?? EMPTY);
    return [
      {
        name: 'Label',
        disabled: none,
        tooltip: none ? noIdTooltip : undefined,
        subMenu: [
          ...LABELS.map<MenuItemDef<Row>>((l, i) => ({
            name: l.name,
            shortcut: String(i + 1),
            icon: swatchHtml(l.key),
            checked: anns.length > 0 && anns.every((a) => a.label?.key === l.key),
            action: () => ctx.annotate(targets, { label: l.key }),
          })),
          'separator',
          {
            name: 'Clear label',
            shortcut: '0',
            disabled: anns.every((a) => !a.label),
            action: () => ctx.annotate(targets, { label: null }),
          },
        ],
      },
      {
        name: 'Annotate…',
        shortcut: 'T',
        disabled: none,
        tooltip: none ? noIdTooltip : 'Label, tags, comment and "After tagging, run…"',
        action: () => setDialog({ targets, focus: 'tags' }),
      },
      {
        name: 'Comment…',
        shortcut: 'C',
        disabled: none,
        action: () => setDialog({ targets, focus: 'comment' }),
      },
      {
        name: 'History',
        shortcut: 'H',
        disabled: !clicked?.id,
        action: () => setDrawer(clicked),
      },
      'separator',
      { name: 'Pivot', subMenu: pivotMenuItems(ctx, targets, false) },
      ...sinkMenuItems(ctx, targets),
      'separator',
      'copy',
      'copyWithHeaders',
      'export',
    ];
  };

  const onKey = (key: string, targets: Row[]) => {
    if (!idsOf(targets).length) return false;
    const n = Number(key);
    if (key >= '1' && key <= String(LABELS.length))
      ctx.annotate(targets, { label: LABELS[n - 1]!.key });
    else if (key === '0') ctx.annotate(targets, { label: null });
    else if (key === 't') setDialog({ targets, focus: 'tags' });
    else if (key === 'c') setDialog({ targets, focus: 'comment' });
    else if (key === 'h') setDrawer(targets[0] ?? null);
    else return false;
    return true;
  };

  const drawerAnn = drawer?.id ? (ctx.store[drawer.id] ?? EMPTY) : null;
  return (
    <Stack direction="row" sx={{ gap: 1 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Grid
          ctx={ctx}
          lead={lead}
          selectionRenderer={SymbolCell}
          fill
          menu={menu}
          onKey={onKey}
          onFocusRow={(r) => drawerOpen.current && r && setDrawer(r)}
        />
      </Box>
      {drawer && (
        <Paper
          variant="outlined"
          sx={{ width: 360, flex: 'none', p: 1.5, overflow: 'auto', height: 'calc(100vh - 190px)' }}
        >
          <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>
              Details · follows the focused row
            </Typography>
            <IconButton size="small" onClick={() => setDrawer(null)} aria-label="Close">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
          {drawer.id && drawerAnn ? (
            <Timeline
              id={drawer.id}
              ann={drawerAnn}
              onComment={(text) => ctx.annotate([drawer], { comment: text })}
            />
          ) : (
            <Alert severity="info">{noIdTooltip}.</Alert>
          )}
          <Divider sx={{ my: 2 }} />
          <Typography variant="overline" color="text.secondary">
            Row
          </Typography>
          <Box
            component="dl"
            sx={{
              fontSize: 12,
              m: 0,
              '& dt': { color: 'text.secondary' },
              '& dd': { m: 0, mb: 0.75, wordBreak: 'break-all' },
            }}
          >
            {COLUMNS.map((c) => (
              <div key={c}>
                <dt>{c}</dt>
                <dd>{String(drawer[c] ?? '')}</dd>
              </div>
            ))}
          </Box>
        </Paper>
      )}
      {dialog && (
        <AnnotateDialog
          ctx={ctx}
          targets={dialog.targets}
          focus={dialog.focus}
          onClose={() => setDialog(null)}
        />
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------- variant B: inspector panel
// No dialog: a docked panel annotates the selection in place. A label click, a tag added or
// removed, and a comment each save at once (with Undo on the toast). The row shows its label as a
// stripe and a named chip, no fill. The right-click menu is flat: the labels at the top level,
// then pivots (recent first) and sinks. With no dialog there's no "After tagging, run…": sinks
// are buttons in the panel.

function VariantB({ ctx }: { ctx: Ctx }) {
  const [selected, setSelected] = useState<Row[]>([]);
  const [focused, setFocused] = useState<Row | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const tagInput = useRef<HTMLInputElement>(null);
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const targets = selected.length ? selected : focused ? [focused] : [];
  const ids = idsOf(targets);
  const anns = ids.map((id) => ctx.store[id] ?? EMPTY);
  const historyId = ids.length === 1 ? ids[0]! : scope && ids.includes(scope) ? scope : null;

  const lead = useMemo<ColDef<Row>[]>(
    () => [
      {
        colId: 'label',
        headerName: 'Label',
        width: 128,
        pinned: 'left',
        cellRenderer: (p: CustomCellRendererProps<Row>) => {
          const a = annOf(p);
          return a?.label ? (
            <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
              <LabelChip labelKey={a.label.key} by={a.label.by} at={a.label.at} />
            </Box>
          ) : null;
        },
      },
      {
        colId: 'tags',
        headerName: 'Tags',
        width: 180,
        pinned: 'left',
        cellRenderer: (p: CustomCellRendererProps<Row>) => (
          <TagChips tags={annOf(p)?.tags ?? []} max={2} />
        ),
      },
      {
        colId: 'comment',
        headerName: 'Latest comment',
        width: 230,
        cellRenderer: (p: CustomCellRendererProps<Row>) => {
          const c = annOf(p)?.comments ?? [];
          const last = c[c.length - 1];
          if (!last) return null;
          return (
            <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.length > 1 && (
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={{ mr: 0.5 }}
                >
                  ({c.length})
                </Typography>
              )}
              <b>{who(last.author)}:</b> {last.text}
            </Box>
          );
        },
      },
    ],
    [],
  );

  const menu = (t: Row[]): MenuItems => {
    const none = idsOf(t).length === 0;
    const a = idsOf(t).map((id) => ctx.store[id] ?? EMPTY);
    return [
      ...LABELS.map<MenuItemDef<Row>>((l, i) => ({
        name: l.name,
        shortcut: String(i + 1),
        icon: swatchHtml(l.key),
        disabled: none,
        tooltip: none ? noIdTooltip : undefined,
        checked: a.length > 0 && a.every((x) => x.label?.key === l.key),
        action: () => ctx.annotate(t, { label: l.key }),
      })),
      {
        name: 'Clear label',
        shortcut: '0',
        disabled: a.every((x) => !x.label),
        action: () => ctx.annotate(t, { label: null }),
      },
      {
        name: 'Tags in the panel',
        shortcut: 'T',
        disabled: none,
        action: () => setTimeout(() => tagInput.current?.focus(), 0),
      },
      {
        name: 'Comment in the panel',
        shortcut: 'C',
        disabled: none,
        action: () => setTimeout(() => commentInput.current?.focus(), 0),
      },
      'separator',
      { name: 'Pivot', subMenu: pivotMenuItems(ctx, t, true) },
      ...sinkMenuItems(ctx, t),
      'separator',
      'copy',
      'copyWithHeaders',
      'export',
    ];
  };

  const onKey = (key: string, t: Row[]) => {
    if (!idsOf(t).length) return false;
    const n = Number(key);
    if (key >= '1' && key <= String(LABELS.length)) ctx.annotate(t, { label: LABELS[n - 1]!.key });
    else if (key === '0') ctx.annotate(t, { label: null });
    else if (key === 't') tagInput.current?.focus();
    else if (key === 'c') commentInput.current?.focus();
    else if (key === 'h') historyRef.current?.scrollIntoView({ behavior: 'smooth' });
    else return false;
    return true;
  };

  const addComment = () => {
    if (!comment.trim()) return;
    ctx.annotate(targets, { comment });
    setComment('');
  };

  return (
    <Stack direction="row" sx={{ gap: 1 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Grid
          ctx={ctx}
          lead={lead}
          fill={false}
          menu={menu}
          onKey={onKey}
          onSelect={(r) => {
            setSelected(r);
            setScope(null);
          }}
          onFocusRow={setFocused}
        />
      </Box>
      <Paper
        variant="outlined"
        sx={{ width: 370, flex: 'none', p: 1.5, overflow: 'auto', height: 'calc(100vh - 190px)' }}
      >
        {targets.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Select rows to annotate them. Keys: 1–{LABELS.length} label, 0 clears, T tags, C
            comment, H history.
          </Typography>
        ) : (
          <>
            <Typography variant="subtitle2">
              {selected.length ? 'Selection' : 'Focused row'}
            </Typography>
            <TargetsLine targets={targets} rows={ctx.rows} />
            {ids.length === 0 ? (
              <Alert severity="info" sx={{ mt: 1 }}>
                {noIdTooltip}.
              </Alert>
            ) : (
              <>
                <Typography variant="overline" sx={{ display: 'block', mt: 1 }}>
                  Label · saves on click
                </Typography>
                <Stack spacing={0.5}>
                  {LABELS.map((l, i) => {
                    const n = anns.filter((a) => a.label?.key === l.key).length;
                    return (
                      <Button
                        key={l.key}
                        size="small"
                        variant={n === anns.length ? 'contained' : 'outlined'}
                        color="inherit"
                        onClick={() => ctx.annotate(targets, { label: l.key })}
                        sx={{
                          justifyContent: 'flex-start',
                          textTransform: 'none',
                          gap: 1,
                          borderLeft: `5px solid ${l.stripe}`,
                          bgcolor: n === anns.length ? l.fill : undefined,
                          boxShadow: 'none',
                        }}
                      >
                        <LabelSymbol labelKey={l.key} size={14} />
                        {l.name}
                        {n > 0 && n < anns.length && (
                          <Typography variant="caption" color="text.secondary">
                            {n}/{anns.length}
                          </Typography>
                        )}
                        <Kbd>{i + 1}</Kbd>
                      </Button>
                    );
                  })}
                  <Button
                    size="small"
                    color="inherit"
                    disabled={anns.every((a) => !a.label)}
                    onClick={() => ctx.annotate(targets, { label: null })}
                    sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                  >
                    Clear label
                    <Kbd>0</Kbd>
                  </Button>
                </Stack>
                <Typography variant="overline" sx={{ display: 'block', mt: 1.5 }}>
                  Tags · save on change
                </Typography>
                <TagEditor
                  anns={anns}
                  add={[]}
                  remove={[]}
                  inputRef={tagInput}
                  recent={ctx.recentTags}
                  onChange={(add, remove) => {
                    if (add.length) ctx.annotate(targets, { addTags: add });
                    if (remove.length) ctx.annotate(targets, { removeTags: remove });
                  }}
                />
                <Typography variant="overline" sx={{ display: 'block', mt: 1.5 }}>
                  Comment
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  size="small"
                  inputRef={commentInput}
                  placeholder={`Added to every id (${ids.length}) · Ctrl+Enter`}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addComment();
                  }}
                />
                <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 0.5 }}>
                  <Button size="small" disabled={!comment.trim()} onClick={addComment}>
                    Comment
                  </Button>
                </Stack>
              </>
            )}
            {ctx.sinks.length > 0 && (
              <>
                <Typography variant="overline" sx={{ display: 'block', mt: 1 }}>
                  Run on these rows
                </Typography>
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                  {ctx.sinks.map((s) => (
                    <Button
                      key={s.key}
                      size="small"
                      variant="outlined"
                      startIcon={<SendIcon fontSize="small" />}
                      onClick={() => ctx.runSink(s.key, targets)}
                      sx={{ textTransform: 'none' }}
                    >
                      {s.name}
                    </Button>
                  ))}
                </Stack>
              </>
            )}
            <Divider sx={{ my: 2 }} />
            <div ref={historyRef} />
            {historyId ? (
              <Timeline id={historyId} ann={ctx.store[historyId] ?? EMPTY} />
            ) : ids.length > 1 ? (
              <>
                <Typography variant="overline" color="text.secondary">
                  History · pick an id
                </Typography>
                <List dense disablePadding>
                  {ids.slice(0, 50).map((id) => {
                    const a = ctx.store[id] ?? EMPTY;
                    return (
                      <ListItemButton key={id} onClick={() => setScope(id)} sx={{ gap: 1 }}>
                        <ListItemText
                          primary={id}
                          secondary={`${a.comments.length} comments · ${a.tags.map((t) => t.tag).join(', ') || 'no tags'}`}
                          slotProps={{ primary: { sx: { fontFamily: 'monospace', fontSize: 11 } } }}
                        />
                        {a.label && <LabelChip labelKey={a.label.key} />}
                      </ListItemButton>
                    );
                  })}
                </List>
              </>
            ) : null}
            {scope && ids.length > 1 && (
              <Button size="small" onClick={() => setScope(null)}>
                Back to the ids
              </Button>
            )}
          </>
        )}
      </Paper>
    </Stack>
  );
}

// ---------------------------------------------------------------- variant C: keyboard first
// A floating action bar on any selection with the analyst's own quick-action slots (1–9: a label,
// a tag, a sink or a pivot; 0 always clears), TIM's own right-click menu with a search field and
// recent pivots first (pivot descriptions show inline), small popovers for tags and comments, and
// one compact Annotations cell (symbol, tags, comment count) that opens the timeline on click.
// The full Annotate dialog, with the sink picker, is still one item away.

type Slot =
  | { kind: 'label'; key: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'sink'; key: string }
  | { kind: 'pivot'; key: string }
  | null;

const DEFAULT_SLOTS: Slot[] = [
  ...LABELS.map<Slot>((l) => ({ kind: 'label', key: l.key })),
  { kind: 'tag', tag: 'IR-2291' },
  { kind: 'pivot', key: 'device-timeline' },
  { kind: 'sink', key: 'save-kusto' },
  null,
];

function slotName(s: Slot): string {
  if (!s) return '';
  if (s.kind === 'label') return labelOf(s.key).name;
  if (s.kind === 'tag') return `+${s.tag}`;
  if (s.kind === 'sink') return SINKS.find((x) => x.key === s.key)?.name ?? s.key;
  return PIVOTS.find((x) => x.key === s.key)?.name ?? s.key;
}
const slotValue = (s: Slot) => (s ? `${s.kind}:${s.kind === 'tag' ? s.tag : s.key}` : '');
function parseSlot(v: string): Slot {
  if (!v) return null;
  const [kind, rest] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
  return kind === 'tag' ? { kind, tag: rest } : ({ kind, key: rest } as Slot);
}

type Pop =
  | { kind: 'tags' | 'comment'; x: number; y: number; targets: Row[] }
  | { kind: 'history'; x: number; y: number; row: Row };

function VariantC({
  ctx,
  slots,
  setSlots,
}: {
  ctx: Ctx;
  slots: Slot[];
  setSlots: (s: Slot[]) => void;
}) {
  const apiRef = useRef<GridApi<Row> | null>(null);
  const [selected, setSelected] = useState<Row[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; targets: Row[]; clicked: Row } | null>(
    null,
  );
  const [pop, setPop] = useState<Pop | null>(null);
  const [dialog, setDialog] = useState<Row[] | null>(null);
  const [customise, setCustomise] = useState(false);

  const usable = (s: Slot, targets: Row[]) =>
    !!s &&
    (s.kind === 'sink'
      ? ctx.sinks.some((x) => x.key === s.key)
      : s.kind === 'pivot'
        ? !(PIVOTS.find((p) => p.key === s.key)?.rows === 'row' && targets.length > 1)
        : idsOf(targets).length > 0);
  const runSlot = (s: Slot, targets: Row[]) => {
    if (!s || !usable(s, targets)) return;
    if (s.kind === 'label') ctx.annotate(targets, { label: s.key });
    else if (s.kind === 'tag') ctx.annotate(targets, { addTags: [s.tag] });
    else if (s.kind === 'sink') ctx.runSink(s.key, targets);
    else ctx.pivot(s.key, targets);
  };

  const centre = () => ({ x: window.innerWidth / 2 - 180, y: window.innerHeight - 380 });
  const onKey = (key: string, targets: Row[]) => {
    if (key >= '1' && key <= '9') runSlot(slots[Number(key) - 1] ?? null, targets);
    else if (key === '0' && idsOf(targets).length) ctx.annotate(targets, { label: null });
    else if (key === 't' && idsOf(targets).length) setPop({ kind: 'tags', ...centre(), targets });
    else if (key === 'c' && idsOf(targets).length)
      setPop({ kind: 'comment', ...centre(), targets });
    else if (key === 'h' && targets[0]?.id)
      setPop({ kind: 'history', ...centre(), row: targets[0] });
    else if (key === 'a' && idsOf(targets).length) setDialog(targets);
    else return false;
    return true;
  };

  const lead = useMemo<ColDef<Row>[]>(
    () => [
      {
        colId: 'ann',
        headerName: 'Annotations',
        width: 200,
        pinned: 'left',
        cellRenderer: (p: CustomCellRendererProps<Row>) => {
          const a = annOf(p);
          if (!a) return null;
          return (
            <Stack
              direction="row"
              spacing={0.75}
              sx={{ alignItems: 'center', height: '100%', cursor: 'pointer' }}
            >
              <Box sx={{ width: 16, flex: 'none' }}>
                {a.label && (
                  <Tooltip
                    title={`${labelOf(a.label.key).name} · ${who(a.label.by)}, ${ago(a.label.at)}`}
                  >
                    <span>
                      {labelOf(a.label.key).symbol ? (
                        <LabelSymbol labelKey={a.label.key} />
                      ) : (
                        <Swatch labelKey={a.label.key} size={12} />
                      )}
                    </span>
                  </Tooltip>
                )}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <TagChips tags={a.tags} max={1} />
              </Box>
              {a.comments.length > 0 && (
                <Stack
                  direction="row"
                  spacing={0.25}
                  sx={{ alignItems: 'center', color: 'text.secondary' }}
                >
                  <ChatBubbleOutlineOutlined sx={{ fontSize: 13 }} />
                  <span>{a.comments.length}</span>
                </Stack>
              )}
            </Stack>
          );
        },
      },
    ],
    [],
  );

  const targetsNow = selected;
  return (
    <Box sx={{ position: 'relative' }}>
      <Grid
        ctx={ctx}
        lead={lead}
        fill
        onApi={(api) => (apiRef.current = api)}
        onMenu={(x, y, targets, clicked) => setMenu({ x, y, targets, clicked })}
        onKey={onKey}
        onSelect={setSelected}
        onCellClicked={(e) => {
          if (e.column.getColId() !== 'ann' || !e.data?.id) return;
          const ev = e.event as MouseEvent | null;
          setPop({ kind: 'history', x: (ev?.clientX ?? 0) + 8, y: ev?.clientY ?? 0, row: e.data });
        }}
      />
      {targetsNow.length > 0 && (
        <ActionBar
          ctx={ctx}
          targets={targetsNow}
          slots={slots}
          usable={usable}
          runSlot={runSlot}
          onTags={(x, y) => setPop({ kind: 'tags', x, y, targets: targetsNow })}
          onComment={(x, y) => setPop({ kind: 'comment', x, y, targets: targetsNow })}
          onAnnotate={() => setDialog(targetsNow)}
          onCustomise={() => setCustomise(true)}
          onClear={() => apiRef.current?.deselectAll()}
        />
      )}
      {menu && (
        <SearchMenu
          ctx={ctx}
          {...menu}
          slots={slots}
          usable={usable}
          runSlot={runSlot}
          onClose={() => setMenu(null)}
          onTags={() => setPop({ kind: 'tags', x: menu.x, y: menu.y, targets: menu.targets })}
          onComment={() => setPop({ kind: 'comment', x: menu.x, y: menu.y, targets: menu.targets })}
          onHistory={() => setPop({ kind: 'history', x: menu.x, y: menu.y, row: menu.clicked })}
          onAnnotate={() => setDialog(menu.targets)}
        />
      )}
      {pop && <CPopover ctx={ctx} pop={pop} onClose={() => setPop(null)} />}
      {dialog && (
        <AnnotateDialog ctx={ctx} targets={dialog} focus="label" onClose={() => setDialog(null)} />
      )}
      {customise && (
        <CustomiseSlots
          ctx={ctx}
          slots={slots}
          setSlots={setSlots}
          onClose={() => setCustomise(false)}
        />
      )}
    </Box>
  );
}

function ActionBar({
  ctx,
  targets,
  slots,
  usable,
  runSlot,
  onTags,
  onComment,
  onAnnotate,
  onCustomise,
  onClear,
}: {
  ctx: Ctx;
  targets: Row[];
  slots: Slot[];
  usable: (s: Slot, t: Row[]) => boolean;
  runSlot: (s: Slot, t: Row[]) => void;
  onTags: (x: number, y: number) => void;
  onComment: (x: number, y: number) => void;
  onAnnotate: () => void;
  onCustomise: () => void;
  onClear: () => void;
}) {
  const ids = idsOf(targets);
  const at = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return [r.left, r.top - 330] as const;
  };
  return (
    <Paper
      elevation={8}
      sx={{
        position: 'absolute',
        bottom: 72,
        left: 0,
        right: 0,
        mx: 'auto',
        width: 'fit-content',
        zIndex: 10,
        px: 1,
        py: 0.5,
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        maxWidth: 'calc(100% - 32px)',
        flexWrap: 'wrap',
        borderRadius: 2,
        '& .MuiButton-root': { fontSize: 12, px: 0.5, minWidth: 0, gap: 0.5 },
      }}
    >
      <Typography variant="body2" sx={{ px: 1, whiteSpace: 'nowrap' }}>
        <b>{plural(targets.length, 'row')}</b> · {plural(ids.length, 'id')}
      </Typography>
      <Divider orientation="vertical" flexItem />
      {slots.map((s, i) =>
        s ? (
          <Tooltip key={i} title={`${slotName(s)} · key ${i + 1}`}>
            <span>
              <Button
                size="small"
                color="inherit"
                disabled={!usable(s, targets)}
                onClick={() => runSlot(s, targets)}
                sx={{ textTransform: 'none', gap: 0.5, minWidth: 0, px: 0.75 }}
              >
                {s.kind === 'label' ? (
                  <Swatch labelKey={s.key} />
                ) : s.kind === 'tag' ? (
                  <LocalOfferOutlined sx={{ fontSize: 14 }} />
                ) : s.kind === 'sink' ? (
                  <SendIcon sx={{ fontSize: 14 }} />
                ) : (
                  <SearchIcon sx={{ fontSize: 14 }} />
                )}
                {slotName(s)}
                <Kbd>{i + 1}</Kbd>
              </Button>
            </span>
          </Tooltip>
        ) : null,
      )}
      <Button
        size="small"
        color="inherit"
        disabled={!ids.length}
        onClick={() => ctx.annotate(targets, { label: null })}
        sx={{ textTransform: 'none' }}
      >
        Clear <Kbd>0</Kbd>
      </Button>
      <Divider orientation="vertical" flexItem />
      <Button
        size="small"
        color="inherit"
        disabled={!ids.length}
        onClick={(e) => onTags(...at(e))}
        sx={{ textTransform: 'none' }}
      >
        Tags… <Kbd>T</Kbd>
      </Button>
      <Button
        size="small"
        color="inherit"
        disabled={!ids.length}
        onClick={(e) => onComment(...at(e))}
        sx={{ textTransform: 'none' }}
      >
        Comment… <Kbd>C</Kbd>
      </Button>
      <Button
        size="small"
        color="inherit"
        disabled={!ids.length}
        onClick={onAnnotate}
        sx={{ textTransform: 'none' }}
      >
        Annotate… <Kbd>A</Kbd>
      </Button>
      <Tooltip title="Customise quick actions">
        <IconButton size="small" onClick={onCustomise}>
          <TuneIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Clear selection">
        <IconButton size="small" onClick={onClear}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Paper>
  );
}

interface MenuEntry {
  key: string;
  section: string;
  primary: ReactNode;
  secondary?: string;
  icon?: ReactNode;
  hint?: string;
  disabled?: boolean;
  /** Matched by the search field. */
  text: string;
  run: () => void;
}

/** TIM's own right-click menu: search first, then quick actions, labels, tags, pivots, sinks. */
function SearchMenu({
  ctx,
  x,
  y,
  targets,
  clicked,
  slots,
  usable,
  runSlot,
  onClose,
  onTags,
  onComment,
  onHistory,
  onAnnotate,
}: {
  ctx: Ctx;
  x: number;
  y: number;
  targets: Row[];
  clicked: Row;
  slots: Slot[];
  usable: (s: Slot, t: Row[]) => boolean;
  runSlot: (s: Slot, t: Row[]) => void;
  onClose: () => void;
  onTags: () => void;
  onComment: () => void;
  onHistory: () => void;
  onAnnotate: () => void;
}) {
  const [q, setQ] = useState('');
  const [allPivots, setAllPivots] = useState(false);
  const ids = idsOf(targets);
  const none = ids.length === 0;
  const anns = ids.map((id) => ctx.store[id] ?? EMPTY);
  const close = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const pivotEntry = (p: PivotDef, section: string): MenuEntry => ({
    key: `${section}-${p.key}`,
    section,
    primary: p.name,
    secondary:
      p.rows === 'row' && targets.length > 1 ? 'Takes one row' : `${p.menuPath} · ${p.description}`,
    icon: <SearchIcon sx={{ fontSize: 15 }} />,
    disabled: p.rows === 'row' && targets.length > 1,
    text: `${p.menuPath} ${p.name} ${p.description}`,
    run: close(() => ctx.pivot(p.key, targets)),
  });
  const counts = tagCounts(anns);
  const entries: MenuEntry[] = [
    ...slots.flatMap<MenuEntry>((s, i) =>
      s
        ? [
            {
              key: `slot-${i}`,
              section: 'Quick actions',
              primary: slotName(s),
              icon:
                s.kind === 'label' ? (
                  <Swatch labelKey={s.key} />
                ) : s.kind === 'tag' ? (
                  <LocalOfferOutlined sx={{ fontSize: 15 }} />
                ) : s.kind === 'sink' ? (
                  <SendIcon sx={{ fontSize: 15 }} />
                ) : (
                  <SearchIcon sx={{ fontSize: 15 }} />
                ),
              hint: String(i + 1),
              disabled: !usable(s, targets),
              text: slotName(s),
              run: close(() => runSlot(s, targets)),
            },
          ]
        : [],
    ),
    // Labels already in a quick-action slot aren't repeated.
    ...LABELS.filter(
      (l) => !slots.some((x) => x?.kind === 'label' && x.key === l.key),
    ).map<MenuEntry>((l) => ({
      key: `label-${l.key}`,
      section: 'Label',
      primary: l.name,
      icon: <Swatch labelKey={l.key} />,
      disabled: none || anns.every((a) => a.label?.key === l.key),
      text: `label ${l.name}`,
      run: close(() => ctx.annotate(targets, { label: l.key })),
    })),
    {
      key: 'clear',
      section: 'Label',
      primary: 'Clear label',
      hint: '0',
      disabled: anns.every((a) => !a.label),
      text: 'clear label',
      run: close(() => ctx.annotate(targets, { label: null })),
    },
    {
      key: 'tags',
      section: 'Annotate',
      primary: 'Tags…',
      hint: 'T',
      disabled: none,
      text: 'tags',
      run: close(onTags),
    },
    {
      key: 'comment',
      section: 'Annotate',
      primary: 'Comment…',
      hint: 'C',
      disabled: none,
      text: 'comment',
      run: close(onComment),
    },
    {
      key: 'annotate',
      section: 'Annotate',
      primary: 'Annotate…',
      secondary: 'Label, tags, comment and After tagging, run…',
      hint: 'A',
      disabled: none,
      text: 'annotate dialog',
      run: close(onAnnotate),
    },
    {
      key: 'history',
      section: 'Annotate',
      primary: 'History',
      hint: 'H',
      disabled: !clicked.id,
      icon: <HistoryIcon sx={{ fontSize: 15 }} />,
      text: 'history timeline',
      run: close(onHistory),
    },
    ...[...new Set([...counts.keys(), ...ctx.recentTags, ...POPULAR_TAGS])]
      .filter((t) => counts.get(t) !== ids.length)
      .map<MenuEntry>((t) => ({
        key: `tag-${t}`,
        section: 'Add tag',
        primary: `+${t}`,
        secondary: counts.get(t) ? `On ${counts.get(t)} of ${ids.length}` : undefined,
        icon: <LocalOfferOutlined sx={{ fontSize: 15 }} />,
        disabled: none,
        text: `tag ${t}`,
        run: close(() => ctx.annotate(targets, { addTags: [t] })),
      })),
    ...ctx.recentPivots.map((k) =>
      pivotEntry(
        PIVOTS.find((p) => p.key === k)!,
        'Recent pivots',
      ),
    ),
    ...availablePivots().map((p) => pivotEntry(p, 'All pivots')),
    ...ctx.sinks.map<MenuEntry>((s) => ({
      key: `sink-${s.key}`,
      section: 'Run',
      primary: s.name,
      secondary: `${s.menuPath} · on ${plural(targets.length, 'row')}, no tab`,
      icon: <SendIcon sx={{ fontSize: 15 }} />,
      text: `${s.menuPath} ${s.name} sink`,
      run: close(() => ctx.runSink(s.key, targets)),
    })),
    {
      key: 'copy',
      section: 'Copy',
      primary: 'Copy row',
      text: 'copy row',
      run: close(
        () => void navigator.clipboard?.writeText(COLUMNS.map((c) => clicked[c] ?? '').join('\t')),
      ),
    },
  ];
  const needle = q.trim().toLowerCase();
  let shown = needle
    ? entries.filter((e) => e.section !== 'Recent pivots' && e.text.toLowerCase().includes(needle))
    : entries.filter((e) =>
        e.section === 'All pivots'
          ? allPivots
          : e.section !== 'Add tag' ||
            ctx.recentTags.includes(e.text.slice(4)) ||
            counts.has(e.text.slice(4)),
      );
  if (
    needle &&
    !none &&
    !entries.some((e) => e.section === 'Add tag' && e.text === `tag ${q.trim()}`)
  )
    shown = [
      ...shown,
      {
        key: 'newtag',
        section: 'Add tag',
        primary: `+${q.trim()}`,
        secondary: 'New tag',
        icon: <LocalOfferOutlined sx={{ fontSize: 15 }} />,
        text: q,
        run: close(() => ctx.annotate(targets, { addTags: [q.trim().slice(0, 100)] })),
      },
    ];
  const sections = [...new Set(shown.map((e) => e.section))];
  const firstEnabled = shown.find((e) => !e.disabled);
  return (
    <Popover
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: y, left: x }}
      marginThreshold={8}
      slotProps={{
        paper: { sx: { width: 340, maxHeight: '75vh', display: 'flex', flexDirection: 'column' } },
      }}
    >
      <Box sx={{ p: 1, pb: 0.5 }}>
        <TextField
          inputRef={focusLater}
          fullWidth
          size="small"
          placeholder="Search labels, tags, pivots, sinks"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && firstEnabled) firstEnabled.run();
          }}
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
        <Box sx={{ mt: 0.5 }}>
          <TargetsLine targets={targets} rows={ctx.rows} />
        </Box>
      </Box>
      <List dense sx={{ overflow: 'auto', py: 0 }}>
        {sections.map((section) => (
          <li key={section}>
            <ul style={{ padding: 0 }}>
              <ListSubheader sx={{ lineHeight: '28px', display: 'flex', alignItems: 'center' }}>
                {section}
                {section === 'All pivots' && !needle && (
                  <IconButton size="small" sx={{ ml: 'auto' }} onClick={() => setAllPivots(false)}>
                    <ExpandLess fontSize="small" />
                  </IconButton>
                )}
              </ListSubheader>
              {shown
                .filter((e) => e.section === section)
                .map((e) => (
                  <ListItemButton
                    key={e.key}
                    disabled={e.disabled}
                    onClick={e.run}
                    selected={!!needle && e === firstEnabled}
                    sx={{ gap: 1, py: 0.25 }}
                  >
                    <Box sx={{ width: 16, display: 'flex', justifyContent: 'center' }}>
                      {e.icon}
                    </Box>
                    <ListItemText
                      primary={e.primary}
                      secondary={e.secondary}
                      slotProps={{ secondary: { sx: { fontSize: 11 } } }}
                    />
                    {e.hint && <Kbd>{e.hint}</Kbd>}
                  </ListItemButton>
                ))}
            </ul>
          </li>
        ))}
        {!needle && !allPivots && (
          <ListItemButton onClick={() => setAllPivots(true)} sx={{ gap: 1 }}>
            <Box sx={{ width: 16 }} />
            <ListItemText
              primary={`All pivots (${availablePivots().length})`}
              secondary="Or type to search them"
            />
            <ExpandMore fontSize="small" />
          </ListItemButton>
        )}
        {shown.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            Nothing matches.
          </Typography>
        )}
      </List>
    </Popover>
  );
}

function CPopover({ ctx, pop, onClose }: { ctx: Ctx; pop: Pop; onClose: () => void }) {
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [text, setText] = useState('');
  const targets = pop.kind === 'history' ? [pop.row] : pop.targets;
  const ids = idsOf(targets);
  const anns = ids.map((id) => ctx.store[id] ?? EMPTY);
  const apply = () => {
    if (pop.kind === 'tags' && (add.length || remove.length))
      ctx.annotate(targets, {
        ...(add.length ? { addTags: add } : {}),
        ...(remove.length ? { removeTags: remove } : {}),
      });
    if (pop.kind === 'comment' && text.trim()) ctx.annotate(targets, { comment: text });
    onClose();
  };
  return (
    <Popover
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: pop.y, left: pop.x }}
      marginThreshold={8}
      slotProps={{
        paper: {
          sx: { width: 360, p: 1.5, maxHeight: '70vh' },
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) apply();
          },
        },
      }}
    >
      {pop.kind === 'history' ? (
        <Timeline
          id={pop.row.id!}
          ann={ctx.store[pop.row.id!] ?? EMPTY}
          dense
          onComment={(t) => ctx.annotate([pop.row], { comment: t })}
        />
      ) : (
        <>
          <Typography variant="subtitle2">{pop.kind === 'tags' ? 'Tags' : 'Comment'}</Typography>
          <TargetsLine targets={targets} rows={ctx.rows} />
          <Box sx={{ mt: 1 }}>
            {pop.kind === 'tags' ? (
              <TagEditor
                anns={anns}
                add={add}
                remove={remove}
                onChange={(a, r) => {
                  setAdd(a);
                  setRemove(r);
                }}
                recent={ctx.recentTags}
                autoFocus
              />
            ) : (
              <TextField
                inputRef={focusLater}
                fullWidth
                multiline
                minRows={3}
                size="small"
                placeholder={`Added to every id (${ids.length})`}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            )}
          </Box>
          <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 1, gap: 1 }}>
            <Button size="small" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={pop.kind === 'tags' ? !add.length && !remove.length : !text.trim()}
              onClick={apply}
            >
              Save · Ctrl+Enter
            </Button>
          </Stack>
        </>
      )}
    </Popover>
  );
}

function CustomiseSlots({
  ctx,
  slots,
  setSlots,
  onClose,
}: {
  ctx: Ctx;
  slots: Slot[];
  setSlots: (s: Slot[]) => void;
  onClose: () => void;
}) {
  const options: { value: string; label: string; group: string }[] = [
    ...LABELS.map((l) => ({ value: `label:${l.key}`, label: `Label → ${l.name}`, group: 'Label' })),
    ...[...new Set([...ctx.recentTags, ...POPULAR_TAGS])].map((t) => ({
      value: `tag:${t}`,
      label: `Add tag ${t}`,
      group: 'Tag',
    })),
    ...SINKS.map((s) => ({ value: `sink:${s.key}`, label: `Run ${s.name}`, group: 'Sink' })),
    ...availablePivots().map((p) => ({
      value: `pivot:${p.key}`,
      label: `Pivot ${p.name} (${p.menuPath})`,
      group: 'Pivot',
    })),
  ];
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Quick actions</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Keys 1–9 in the grid, the action bar and the top of the right-click menu. 0 always clears
          the label. Yours only, kept with your account.
        </Typography>
        <Stack spacing={1}>
          {slots.map((s, i) => (
            <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Kbd>{i + 1}</Kbd>
              <TextField
                select
                fullWidth
                size="small"
                value={slotValue(s)}
                onChange={(e) =>
                  setSlots(slots.map((x, k) => (k === i ? parseSlot(e.target.value) : x)))
                }
              >
                <MenuItem value="">
                  <em>Nothing</em>
                </MenuItem>
                {options.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setSlots(DEFAULT_SLOTS)}>Reset</Button>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------- page

const VARIANTS = [
  { key: 'A', name: 'Menu + dialog' },
  { key: 'B', name: 'Inspector panel' },
  { key: 'C', name: 'Keyboard first' },
];
const VARIANT_KEYS = VARIANTS.map((v) => v.key);

export function GridTaggingPage() {
  const variant = usePrototypeVariant(VARIANT_KEYS);
  const [rows] = useState(makeRows);
  const [store, setStore] = useState(() => seedStore(rows));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastRequest, setLastRequest] = useState('');
  const [sinksOn, setSinksOn] = useState(true);
  const [sinkFails, setSinkFails] = useState(false);
  const [remember, setRemember] = useState(true);
  const [lastSink, setLastSink] = useState<string | null>(null);
  const [recentPivots, setRecentPivots] = useState<string[]>(['signins']);
  const [recentTags, setRecentTags] = useState<string[]>(['phish-campaign-0412']);
  const [flash, setFlash] = useState<Ctx['flash']>(null);
  const [slots, setSlots] = useState<Slot[]>(DEFAULT_SLOTS);
  const toastKey = useRef(0);

  const toast = (t: Omit<Toast, 'key'>) => {
    const key = ++toastKey.current;
    setToasts((ts) => [...ts.slice(-3), { ...t, key }]);
    if (!t.sticky) setTimeout(() => setToasts((ts) => ts.filter((x) => x.key !== key)), 6000);
    return key;
  };
  const dismiss = (key: number) => setToasts((ts) => ts.filter((x) => x.key !== key));
  const fmtIds = (ids: string[]) =>
    JSON.stringify(ids.length > 2 ? [...ids.slice(0, 2), `…${ids.length - 2} more`] : ids);

  const runSink = (key: string, targets: readonly Row[]) => {
    const s = SINKS.find((x) => x.key === key)!;
    const snapshot = [...targets];
    const fails = sinkFails;
    setLastRequest(`POST /api/runs {action:"${key}", input:{columns, rows:[${snapshot.length}]}}`);
    const k = toast({
      text: `${s.name}: sending ${plural(snapshot.length, 'row')}…`,
      severity: 'info',
      sticky: true,
    });
    setTimeout(() => {
      dismiss(k);
      if (fails)
        toast({
          text: `${s.name} failed: Forbidden: you can't write to SavedEvents`,
          severity: 'error',
          sticky: true,
          actions: [{ label: 'Retry', run: () => runSink(key, snapshot) }],
        });
      else toast({ text: `${s.name}: ${plural(snapshot.length, 'row')}`, severity: 'success' });
    }, 1400);
  };

  const annotate = (targets: readonly Row[], patch: Patch, sink?: string | null) => {
    const ids = idsOf(targets);
    if (!ids.length) return;
    const before = Object.fromEntries(ids.map((id) => [id, store[id] ?? EMPTY]));
    setStore((s) => applyPatch(s, ids, patch, ME, Date.now()));
    setLastRequest(
      `PATCH /api/annotations ${JSON.stringify({ ids: '…', ...patch }).replace('"…"', fmtIds(ids))}`,
    );
    if (patch.addTags?.length)
      setRecentTags((r) => [...new Set([...patch.addTags!, ...r])].slice(0, 6));
    const idSet = new Set(ids);
    const touched = rows.filter((r) => r.id && idSet.has(r.id)).length;
    const undoable = patch.label !== undefined || patch.addTags?.length || patch.removeTags?.length;
    const undo = () => {
      setStore((s) => {
        let n = s;
        for (const id of ids) {
          const b = before[id]!;
          const had = new Set(b.tags.map((t) => t.tag));
          n = applyPatch(
            n,
            [id],
            {
              ...(patch.label !== undefined ? { label: b.label?.key ?? null } : {}),
              addTags: (patch.removeTags ?? []).filter((t) => had.has(t)),
              removeTags: (patch.addTags ?? []).filter((t) => !had.has(t)),
            },
            ME,
            Date.now(),
          );
        }
        return n;
      });
      setLastRequest(
        'PATCH /api/annotations (undo: per-id inverse, a new label change in history)',
      );
    };
    toast({
      text: (
        <>
          {describe(patch)} on {plural(ids.length, 'id')}
          {touched > targets.length && ` (${plural(touched, 'row')})`}
          {patch.comment && !undoable && ' · comments can’t be undone'}
        </>
      ),
      severity: 'success',
      actions: undoable ? [{ label: 'Undo', run: undo }] : undefined,
    });
    if (sink) {
      setLastSink(sink);
      runSink(sink, targets);
    }
  };

  const pivot = (key: string, targets: readonly Row[]) => {
    const p = PIVOTS.find((x) => x.key === key)!;
    const first = targets[0]?.[p.columns[0]!];
    setRecentPivots((r) => [key, ...r.filter((k) => k !== key)].slice(0, 3));
    setLastRequest(`POST /api/actions/${key}/resolve {context:{rows:[${targets.length}]}}`);
    toast({
      text: `Opened ${p.name}: ${targets.length > 1 ? plural(targets.length, 'row') : String(first)} in the background`,
      severity: 'info',
      actions: [
        {
          label: 'Go to',
          run: () => toast({ text: 'Prototype: Go to would switch to the tab', severity: 'info' }),
        },
      ],
    });
  };

  const teammate = () => {
    const ids = idsOf(rows);
    const id = ids[Math.floor(Math.random() * ids.length)]!;
    const l = LABELS[Math.floor(Math.random() * LABELS.length)]!;
    setStore((s) =>
      applyPatch(
        s,
        [id],
        { label: l.key, addTags: ['IR-2291'], comment: 'Same infrastructure as IR-2291.' },
        'sam@contoso.com',
        Date.now(),
      ),
    );
    setFlash((f) => ({ ids: [id], n: (f?.n ?? 0) + 1 }));
    setLastRequest(`GET /api/annotations/changes?since=… → sam: ${l.name} on ${id.slice(0, 10)}…`);
  };

  const ctx: Ctx = {
    rows,
    store,
    sinks: sinksOn ? SINKS : [],
    annotate,
    runSink,
    pivot,
    recentPivots,
    defaultSink: remember && lastSink ? lastSink : '',
    recentTags,
    flash,
  };

  return (
    <Box sx={{ p: 1.5, pb: 8, bgcolor: 'background.default', minHeight: '100vh' }}>
      <LabelStyles />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mr: 1 }}>
          Alerts with evidence
        </Typography>
        {['Connection: Defender (prod)', 'Since: 24 h ago', 'Severity: any'].map((p) => (
          <Chip key={p} size="small" variant="outlined" label={p} />
        ))}
        <Box sx={{ flex: 1 }} />
        <Tabs value={1} sx={{ minHeight: 32, '& .MuiTab-root': { minHeight: 32, py: 0 } }}>
          <MuiTab label="Query" disabled />
          <MuiTab label={`Results · ${rows.length}`} />
          <MuiTab label="Run" disabled />
        </Tabs>
      </Stack>
      {variant === 'A' && <VariantA key="A" ctx={ctx} />}
      {variant === 'B' && <VariantB key="B" ctx={ctx} />}
      {variant === 'C' && <VariantC key="C" ctx={ctx} slots={slots} setSlots={setSlots} />}
      <Stack
        spacing={1}
        sx={{ position: 'fixed', right: 16, bottom: 80, zIndex: 1500, width: 400 }}
      >
        {toasts.map((t) => (
          <Alert
            key={t.key}
            severity={t.severity}
            variant="filled"
            onClose={() => dismiss(t.key)}
            action={
              <>
                {t.actions?.map((a) => (
                  <Button
                    key={a.label}
                    color="inherit"
                    size="small"
                    onClick={() => {
                      dismiss(t.key);
                      a.run();
                    }}
                  >
                    {a.label}
                  </Button>
                ))}
                <IconButton size="small" color="inherit" onClick={() => dismiss(t.key)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </>
            }
          >
            {t.text}
          </Alert>
        ))}
      </Stack>
      <PrototypeSwitcher
        variants={VARIANTS}
        state={
          <span
            style={{ display: 'inline-flex', gap: 10, alignItems: 'center', whiteSpace: 'nowrap' }}
          >
            <label>
              <input
                type="checkbox"
                checked={sinksOn}
                onChange={(e) => setSinksOn(e.target.checked)}
              />{' '}
              sinks
            </label>
            <label>
              <input
                type="checkbox"
                checked={sinkFails}
                onChange={(e) => setSinkFails(e.target.checked)}
              />{' '}
              sink fails
            </label>
            <label>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />{' '}
              remember sink
            </label>
            <button type="button" onClick={teammate}>
              teammate change
            </button>
            <span
              title={lastRequest}
              style={{
                maxWidth: 320,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {lastRequest || 'no request yet'}
            </span>
          </span>
        }
      />
    </Box>
  );
}
