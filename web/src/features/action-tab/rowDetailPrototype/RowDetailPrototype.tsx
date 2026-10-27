/* eslint-disable react-refresh/only-export-components -- PROTOTYPE (#170) */
/**
 * PROTOTYPE (#170, throwaway, branch prototype/170-row-detail only; never merge).
 *
 * Question: what should Row detail look like? Three layouts of one side panel with a row's
 * fields and its `id`'s annotations, switchable with `?variant=A|B|C|today` in the action tab,
 * plus `font`, `long` and `fold` settings in the floating bar:
 *
 * - A: header (id, label, tags), then the fields, then the comment box and history.
 * - B: two columns: fields left, annotations right (folds to a rail).
 * - C: the fields, then all the annotations under them (folds to a summary line).
 * - today: Show details and History as they are on main, to compare.
 *
 * D toggles the panel on the focused row; it follows the focused row. Runs on the real api
 * (`npm run prototype:row-detail`), so comments are real, in a throwaway database.
 */
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopy from '@mui/icons-material/ContentCopy';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import type { CellFocusedEvent, CellKeyDownEvent } from 'ag-grid-community';
import {
  useCallback,
  useContext,
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  PrototypeSetting,
  PrototypeSwitcher,
  usePrototypeParam,
} from '../../../components/PrototypeSwitcher';
import { NotifyContext } from '../../../components/notifyContext';
import { getAnnotationStore, pollAnnotationsSoon } from '../../../lib/annotations';
import {
  changeAnnotations,
  getAnnotationHistory,
  isApiError,
  type Annotations,
  type HistoryEntry,
  type InstanceLabel,
} from '../../../lib/api';
import { formatUtcDate, formatUtcTime } from '../../../lib/utcFormat';
import type { ExtraMenuItems, GetExtraContextMenuItems, GridRowWithId } from '../../grid';
import { dump } from 'js-yaml';
import { detailEntries } from '../../grid/detailText';
import { shownLabel, targetIds, whyUnlabellable, type LabelledRow } from '../../labels';

// --- Settings ------------------------------------------------------------------------------------

const VARIANTS = [
  { key: 'A', name: 'Header, fields, history' },
  { key: 'B', name: 'Two columns' },
  { key: 'C', name: 'Fields, then annotations' },
  { key: 'today', name: 'Today: Show details + History' },
] as const;
const FONTS = ['current', 'mono', 'mixed'] as const;
const LONGS = ['wrap', 'clamp', 'scroll', 'args'] as const;
const FOLDS = ['on', 'off'] as const;
const OBJECTS = ['tree', 'yaml-wide', 'yaml', 'json'] as const;
const ORDERS = ['run', 'raw', 'grid'] as const;

type Font = (typeof FONTS)[number];
type Long = (typeof LONGS)[number];
interface Settings {
  variant: string;
  font: Font;
  long: Long;
  fold: boolean;
  /** How objects are shown and copied. */
  objects: (typeof OBJECTS)[number];
  /** run: the run's columns (declared, then first seen); raw: the stored jsonb's keys; grid: the grid's columns. */
  order: (typeof ORDERS)[number];
}

export function useRowDetailSettings(): Settings {
  return {
    variant: usePrototypeParam('variant', 'A'),
    font: usePrototypeParam('font', 'mixed') as Font,
    long: usePrototypeParam('long', 'clamp') as Long,
    fold: usePrototypeParam('fold', 'on') === 'on',
    objects: usePrototypeParam('objects', 'tree') as Settings['objects'],
    order: usePrototypeParam('order', 'run') as Settings['order'],
  };
}

/** The floating bar: variant, font, long values, folding. Mounted once, in the app shell. */
export function RowDetailSwitcher() {
  const s = useRowDetailSettings();
  return (
    <PrototypeSwitcher variants={VARIANTS} current={s.variant}>
      <PrototypeSetting name="font" label="font" options={FONTS} value={s.font} />
      <PrototypeSetting name="long" label="long" options={LONGS} value={s.long} />
      <PrototypeSetting name="fold" label="fold" options={FOLDS} value={s.fold ? 'on' : 'off'} />
      <PrototypeSetting name="objects" label="objects" options={OBJECTS} value={s.objects} />
      <PrototypeSetting name="order" label="order" options={ORDERS} value={s.order} />
    </PrototypeSwitcher>
  );
}

// The grid's column order (hidden columns too), taken from the grid on each open and focus, so the
// fields follow the grid rather than the row's stored (jsonb) key order. Question for #170.
let columnOrder: string[] = [];
// The run's columns, in the order the run reported them: declared ones first, then first seen.
let runOrder: string[] = [];
const keepOrder = (api: { getColumns: () => { getColId: () => string }[] | null }) => {
  columnOrder = api.getColumns()?.map((c) => c.getColId()) ?? [];
};

// --- The hook: menu item, D, following the focused row -------------------------------------------

export interface RowDetailPrototype {
  menu: GetExtraContextMenuItems;
  keys: (e: CellKeyDownEvent<GridRowWithId>) => void;
  onCellFocused: (e: CellFocusedEvent<GridRowWithId>) => void;
  panel: ReactNode;
  open: (row: LabelledRow) => void;
}

export function useRowDetailPrototype({
  labels,
  idParam,
  runColumns,
}: {
  labels: readonly InstanceLabel[];
  idParam: boolean;
  runColumns: readonly { name: string }[] | null | undefined;
}): RowDetailPrototype {
  const settings = useRowDetailSettings();
  useEffect(() => {
    runOrder = runColumns?.map((c) => c.name) ?? [];
  }, [runColumns]);
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<LabelledRow | null>(null);
  const [stored, setStored] = useState<Annotations | null>(null);
  // Comment drafts per id, kept while the panel is open (Q5).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const id = row?.id ?? null;
  const annotations = stored !== null && stored.id === id ? stored : null;

  useEffect(() => {
    if (id === null) return;
    let live = true;
    const store = getAnnotationStore();
    void store.get([id]).then((found) => {
      const current = found.get(id);
      if (live && current) setStored(current);
    });
    const unsubscribe = store.subscribe(({ changes }) => {
      const change = changes.find((c) => c.id === id);
      if (change) setStored(change);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [id]);

  const openOn = useCallback((target: LabelledRow) => {
    setRow(target);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setDrafts({});
  }, []);
  const menu = useCallback<GetExtraContextMenuItems>(
    (params) => {
      const target = params.node?.data as LabelledRow | undefined;
      if (!target) return [];
      keepOrder(params.api);
      const items: ExtraMenuItems = [
        { name: 'Row detail', shortcut: 'D', action: () => openOn(target) },
      ];
      return items;
    },
    [openOn],
  );
  const keys = useCallback(
    (e: CellKeyDownEvent<GridRowWithId>) => {
      const key = e.event as globalThis.KeyboardEvent | null | undefined;
      if (!key || key.ctrlKey || key.metaKey || key.altKey || key.key.toLowerCase() !== 'd') return;
      const target = e.node.data;
      if (!target || e.api.getEditingCells().length > 0) return;
      key.preventDefault();
      keepOrder(e.api);
      if (open) close();
      else openOn(target);
    },
    [open, close, openOn],
  );
  const onCellFocused = useCallback(
    (e: CellFocusedEvent<GridRowWithId>) => {
      if (!open || e.rowIndex === null) return;
      keepOrder(e.api);
      const data = e.api.getDisplayedRowAtIndex(e.rowIndex)?.data;
      if (data) setRow(data);
    },
    [open],
  );
  const onCommented = useCallback(async (changes: Annotations[]) => {
    await getAnnotationStore().apply(changes, 'own');
    pollAnnotationsSoon();
  }, []);

  const props: PanelProps = {
    row,
    annotations,
    labels,
    reason: id === null ? whyUnlabellable(targetIds(row ? [row] : []), Infinity, idParam) : null,
    draft: id === null ? '' : (drafts[id] ?? ''),
    setDraft: (text) => id !== null && setDrafts((d) => ({ ...d, [id]: text })),
    onCommented,
    onClose: close,
    s: settings,
  };
  const panel =
    open &&
    (settings.variant === 'B' ? (
      <VariantB {...props} />
    ) : settings.variant === 'C' ? (
      <VariantC {...props} />
    ) : (
      <VariantA {...props} />
    ));
  return { menu, keys, onCellFocused, panel, open: openOn };
}

interface PanelProps {
  row: LabelledRow | null;
  annotations: Annotations | null;
  labels: readonly InstanceLabel[];
  /** Why the row has no annotations, when it has no id. */
  reason: string | null;
  draft: string;
  setDraft: (text: string) => void;
  onCommented: (changes: Annotations[]) => void | Promise<void>;
  onClose: () => void;
  s: Settings;
}

// --- Shared pieces -------------------------------------------------------------------------------

const MONO = 'ui-monospace, "Cascadia Mono", "SF Mono", Consolas, "Roboto Mono", monospace';

/** Per font setting: the name's and the value's type, and the gap between fields. */
const TYPE: Record<Font, { name: SxProps<Theme>; value: SxProps<Theme>; pad: string }> = {
  // As DetailFields on main: 0.9rem body font for both, names bold.
  current: {
    name: { fontSize: '0.9rem', fontWeight: 500 },
    value: { fontSize: '0.9rem' },
    pad: '3px',
  },
  // Small grey names, every value monospace.
  mono: {
    name: { fontSize: 12, fontWeight: 500, color: 'text.secondary', lineHeight: 1.6 },
    value: { fontSize: 12.5, fontFamily: MONO, lineHeight: 1.5 },
    pad: '2px',
  },
  // Small grey names, sans values, monospace only for technical values (paths, hashes, commands).
  mixed: {
    name: { fontSize: 12, fontWeight: 500, color: 'text.secondary', lineHeight: 1.6 },
    value: { fontSize: 13, lineHeight: 1.45 },
    pad: '2px',
  },
};

/** Paths, hashes, command lines, IPs, SIDs, JSON: worth a monospace font. */
const technical = (text: string) =>
  text.length > 60 ||
  /[\\/=;{}]/.test(text) ||
  /^[0-9a-f-]{12,}$/i.test(text) ||
  /^\d{1,3}(\.\d{1,3}){3}$/.test(text) ||
  /^S-1-/.test(text);

const formatAt = (at: string) => {
  const d = new Date(at);
  return `${formatUtcDate(d)} ${formatUtcTime(d)} UTC`;
};

const reasonOf = (e: unknown): string => {
  if (isApiError(e) && e.errors) return Object.values(e.errors).flat().join('; ');
  return e instanceof Error ? e.message : String(e);
};

function CopyButton({ text, what }: { text: string; what: string }) {
  const notify = useContext(NotifyContext);
  return (
    <IconButton
      className="copy"
      size="small"
      aria-label={`Copy ${what}`}
      title={`Copy ${what}`}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => notify?.(`Copied ${what}`));
      }}
      sx={{ opacity: 0, p: '2px', mt: '-1px', flexShrink: 0, '&:focus-visible': { opacity: 1 } }}
    >
      <ContentCopy sx={{ fontSize: 14 }} />
    </IconButton>
  );
}

const looksLikeCommand = (name: string, text: string) =>
  /commandline|cmdline/i.test(name) || (/\.(exe|ps1|bat|cmd)\b/i.test(text) && text.length > 80);

/**
 * A command line, one argument per line: a new line before each flag (`-x`, `/x`, `--x`) and each
 * `&&` or `|`; a long `;` list (a classpath) and a long quoted `&&` chain are split too.
 */
function commandLines(text: string): string[] {
  const tokens = text.match(/(?:"[^"]*"|\S)+/g) ?? [text];
  const lines: string[] = [];
  for (const token of tokens) {
    const flag = /^(-{1,2}|\/)[A-Za-z*]/.test(token) && token.length < 40;
    const joiner = ['&&', '||', '|', ';'].includes(token);
    if (lines.length === 0 || flag || joiner) lines.push(token);
    else if (token.length > 100 && token.includes(';'))
      lines.push(...token.split(/(?<=;)/).map((t) => `  ${t}`));
    else if (token.length > 100 && token.includes(' && '))
      lines.push(...token.split(/(?= && )/).map((t) => `  ${t.trim()}`));
    else lines[lines.length - 1] += ` ${token}`;
  }
  return lines;
}

const CLAMP_LINES = 3;

function Value({
  name,
  text,
  rich,
  long,
  sx,
}: {
  name: string;
  text: string;
  /** What to show in place of `text`, which is still what's measured. */
  rich?: ReactNode;
  long: Long;
  sx: SxProps<Theme>;
}) {
  const [all, setAll] = useState(false);
  const base = { flex: 1, minWidth: 0, ...(sx as object) };
  if (long === 'scroll') {
    return (
      <Box
        sx={{
          ...base,
          whiteSpace: 'pre',
          overflowX: 'auto',
          scrollbarWidth: 'thin',
        }}
      >
        {rich ?? text}
      </Box>
    );
  }
  if (long === 'args' && looksLikeCommand(name, text)) {
    return (
      <Box sx={{ ...base, overflowWrap: 'anywhere' }}>
        {commandLines(text).map((line, i) => (
          <Box key={i} sx={{ pl: i === 0 ? 0 : '2ch', whiteSpace: 'pre-wrap' }}>
            {line}
          </Box>
        ))}
      </Box>
    );
  }
  if (long === 'clamp') {
    const isLong = text.length > 180 || text.split('\n').length > CLAMP_LINES;
    return (
      <Box sx={base}>
        <Box
          sx={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            ...(isLong && !all
              ? {
                  display: '-webkit-box',
                  WebkitLineClamp: CLAMP_LINES,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }
              : {}),
          }}
        >
          {rich ?? text}
        </Box>
        {isLong && (
          <Link
            component="button"
            variant="caption"
            onClick={() => setAll((a) => !a)}
            sx={{ fontFamily: 'inherit' }}
          >
            {all ? 'Show less' : `Show all (${text.length.toLocaleString()} characters)`}
          </Link>
        )}
      </Box>
    );
  }
  return (
    <Box sx={{ ...base, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{rich ?? text}</Box>
  );
}

// --- tree: YAML-style, but nothing quoted: strings as they are, other types in their own colour --

type Seg = { text: string; kind: 'key' | 'plain' | 'typed' };
type Line = Seg[];

const isBlock = (v: unknown): v is object =>
  typeof v === 'object' && v !== null && Object.keys(v).length > 0;

/** A scalar, or an empty array or object: strings plain, everything else typed. */
function scalar(v: unknown): Seg {
  if (typeof v === 'string')
    return v === '' ? { text: '""', kind: 'typed' } : { text: v, kind: 'plain' };
  if (Array.isArray(v)) return { text: '[]', kind: 'typed' };
  if (typeof v === 'object' && v !== null) return { text: '{}', kind: 'typed' };
  return { text: String(v), kind: 'typed' };
}

/** One value after `head` (a key, or a list dash), at `indent`. */
function entry(head: Seg[], v: unknown, indent: number): Line[] {
  const pad = ' '.repeat(indent);
  if (typeof v === 'string' && v.includes('\n')) {
    return [head, ...v.split('\n').map((l) => [{ text: `${pad}  ${l}`, kind: 'plain' as const }])];
  }
  if (!isBlock(v)) return [[...head, { text: ' ', kind: 'plain' }, scalar(v)]];
  return [head, ...treeLines(v, indent + 2)];
}

function treeLines(v: object, indent: number): Line[] {
  const pad = ' '.repeat(indent);
  if (Array.isArray(v)) {
    return v.flatMap((item: unknown) => {
      if (!isBlock(item)) return entry([{ text: `${pad}-`, kind: 'key' }], item, indent);
      // The item's first line goes on the dash's line, as YAML does.
      const [first = [], ...rest] = treeLines(item, indent + 2);
      const [lead = { text: '', kind: 'plain' as const }, ...more] = first;
      return [
        [
          { text: `${pad}- `, kind: 'key' as const },
          { ...lead, text: lead.text.trimStart() },
          ...more,
        ],
        ...rest,
      ];
    });
  }
  return Object.entries(v).flatMap(([k, val]) =>
    entry([{ text: `${pad}${k}:`, kind: 'key' }], val, indent),
  );
}

const TREE_COLOUR: Record<Seg['kind'], string | undefined> = {
  key: 'text.secondary',
  plain: undefined,
  typed: 'info.main',
};

function tree(v: object): { text: string; rich: ReactNode } {
  const lines = treeLines(v, 0);
  return {
    text: lines.map((l) => l.map((sg) => sg.text).join('')).join('\n'),
    // One block per line, indented in ch (the font is monospace), with a hanging indent: a line
    // that wraps carries on 2 characters in from where it started, not at the left edge.
    rich: lines.map((line, i) => {
      const lead = line[0]?.text ?? '';
      const indent = lead.length - lead.trimStart().length;
      return (
        <Box key={i} sx={{ pl: `${indent + 2}ch`, textIndent: '-2ch' }}>
          {line.map((sg, j) => (
            <Box component="span" key={j} sx={{ color: TREE_COLOUR[sg.kind] }}>
              {j === 0 ? sg.text.trimStart() : sg.text}
            </Box>
          ))}
        </Box>
      );
    }),
  };
}

/** The row's fields, names left, values right with a copy button each; empty values are left out. */
function Fields({
  row,
  nameWidth,
  s,
}: {
  row: LabelledRow | null;
  nameWidth: number;
  s: Settings;
}) {
  const type = TYPE[s.font];
  const order = s.order === 'grid' ? columnOrder : runOrder;
  const rank = (key: string) => {
    const i = order.indexOf(key);
    return i === -1 ? Infinity : i;
  };
  const data = (row?.data ?? {}) as Record<string, unknown>;
  const isObject = (key: string) => typeof data[key] === 'object' && data[key] !== null;
  // yaml: as main (js-yaml folds strings over 80 characters); yaml-wide: no folding.
  const shown = (key: string, text: string): { text: string; rich?: ReactNode } =>
    !isObject(key) || s.objects === 'yaml'
      ? { text }
      : s.objects === 'json'
        ? { text: JSON.stringify(data[key], null, 2) }
        : s.objects === 'tree'
          ? tree(data[key] as object)
          : { text: dump(data[key], { lineWidth: -1 }) };
  const entries = detailEntries(data)
    .map((e) => ({
      ...e,
      ...shown(e.key, e.text),
      // Objects are copied as JSON, whatever the panel shows.
      copy: isObject(e.key) ? JSON.stringify(data[e.key], null, 2) : e.text,
    }))
    .sort((a, b) => (s.order === 'raw' ? 0 : rank(a.key) - rank(b.key)));
  return (
    <Box
      component="dl"
      // Another row starts with its values clamped again.
      key={row?.row}
      aria-label="Fields"
      sx={{ display: 'grid', gridTemplateColumns: `${nameWidth}px minmax(0, 1fr)`, m: 0 }}
    >
      {entries.map(({ key, text, rich, copy }) => {
        const object = typeof data[key] === 'object' && data[key] !== null;
        const mono =
          s.font === 'mixed' && (object || technical(text))
            ? { fontFamily: MONO, fontSize: 12.5 }
            : {};
        return (
          <Box
            key={key}
            sx={{
              display: 'contents',
              '&:hover > *': { bgcolor: 'action.hover' },
              '&:hover .copy, &:focus-within .copy': { opacity: 1 },
            }}
          >
            <Box
              component="dt"
              sx={{
                ...(type.name as object),
                py: type.pad,
                pl: 0.5,
                pr: 1,
                overflowWrap: 'anywhere',
              }}
            >
              {key}
            </Box>
            <Box
              component="dd"
              sx={{
                m: 0,
                py: type.pad,
                pr: 0.5,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 0.5,
                minWidth: 0,
              }}
            >
              <Value
                name={key}
                text={text}
                rich={rich}
                long={s.long}
                sx={{ ...(type.value as object), ...mono }}
              />
              <CopyButton text={copy} what={key} />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function IdLine({ id }: { id: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        '&:hover .copy, &:focus-within .copy': { opacity: 1 },
      }}
    >
      <Typography
        component="code"
        sx={{ fontFamily: MONO, fontSize: 13, overflowWrap: 'anywhere' }}
      >
        {id}
      </Typography>
      <CopyButton text={id} what="id" />
    </Box>
  );
}

function LabelLine({
  annotations,
  labels,
}: {
  annotations: Annotations | null;
  labels: readonly InstanceLabel[];
}) {
  const label = annotations?.label ?? null;
  if (!label)
    return (
      <Typography variant="body2" color="text.secondary">
        No label
      </Typography>
    );
  const shown = shownLabel(label.key, labels);
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: '2px',
          alignSelf: 'center',
          bgcolor: `var(--mui-palette-labelStripe-${shown.colour})`,
        }}
      />
      <Typography variant="subtitle2">{shown.name}</Typography>
      <Typography variant="caption" color="text.secondary">
        {`${label.by} · ${formatAt(label.at)}`}
      </Typography>
    </Box>
  );
}

function Tags({ annotations }: { annotations: Annotations | null }) {
  const tags = annotations?.tags ?? [];
  if (tags.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {tags.map((tag) => (
        <Chip key={tag} size="small" label={tag} />
      ))}
    </Box>
  );
}

/** The history of `id`, read again when its version changes or after a comment from the panel. */
function useHistory(id: string | null, version: number | undefined) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [shownId, setShownId] = useState(id);
  if (shownId !== id) {
    setShownId(id);
    setEntries(null);
    setError(null);
  }
  useEffect(() => {
    if (id === null) return;
    let live = true;
    getAnnotationHistory(id).then(
      (h) => {
        if (!live) return;
        setEntries(h.entries);
        setError(null);
      },
      (e: unknown) => live && setError(`Couldn't load the history: ${reasonOf(e)}`),
    );
    return () => {
      live = false;
    };
  }, [id, version, reloads]);
  return { entries, error, reload: () => setReloads((n) => n + 1) };
}

function CommentBox({
  id,
  draft,
  setDraft,
  onCommented,
  onAdded,
  minRows = 2,
}: {
  id: string;
  draft: string;
  setDraft: (text: string) => void;
  onCommented: PanelProps['onCommented'];
  onAdded: () => void;
  minRows?: number;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    const text = draft.trim();
    if (text === '' || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { changes } = await changeAnnotations({ ids: [id], comment: text });
      await onCommented(changes);
      setDraft('');
      onAdded();
    } catch (e) {
      setError(`Couldn't add the comment: ${reasonOf(e)}`);
    } finally {
      setSaving(false);
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void add();
    }
  };
  return (
    <Box>
      <TextField
        label="Comment"
        multiline
        minRows={minRows}
        fullWidth
        size="small"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        helperText="Ctrl+Enter adds"
      />
      <Box sx={{ textAlign: 'right', mt: -2.5 }}>
        <Button size="small" onClick={() => void add()} disabled={draft.trim() === '' || saving}>
          Add comment
        </Button>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  );
}

function HistoryList({
  entries,
  labels,
}: {
  entries: readonly HistoryEntry[];
  labels: readonly InstanceLabel[];
}) {
  const labelName = (key: string | null) =>
    key === null ? 'No label' : shownLabel(key, labels).name;
  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No history yet.
      </Typography>
    );
  }
  return (
    <Box component="ul" aria-label="History" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {entries.map((entry, i) => {
        if (entry.kind === 'comment') {
          return (
            <Box component="li" key={i} sx={{ mb: 1.25 }}>
              <Typography variant="caption" color="text.secondary" component="div">
                {`${entry.author} · ${formatAt(entry.at)}`}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
                {entry.text}
              </Typography>
            </Box>
          );
        }
        const older = entries.slice(i + 1).find((e) => e.kind === 'label');
        const before = older?.kind === 'label' ? older.label : null;
        return (
          <Box component="li" key={i} sx={{ mb: 1.25 }}>
            <Typography variant="caption" color="text.secondary">
              {`${labelName(before)} → ${labelName(entry.label)} · ${entry.by} · ${formatAt(entry.at)}`}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

const comments = (entries: readonly HistoryEntry[] | null) =>
  entries?.filter((e) => e.kind === 'comment').length ?? 0;

// Fold states, remembered for as long as the page is open (every row, every tab, each opening).
const remembered = { historyFolded: false, annotationsFolded: true, columnFolded: false };

function useRemembered(key: keyof typeof remembered) {
  const [value, setValue] = useState(remembered[key]);
  return [
    value,
    (next: boolean) => {
      remembered[key] = next;
      setValue(next);
    },
  ] as const;
}

/** The panel: a persistent right drawer in the grid's container, 900px, capped at the container. */
function Shell({
  row,
  onClose,
  children,
}: {
  row: LabelledRow | null;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Drawer
      variant="persistent"
      anchor="right"
      open
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 900,
        maxWidth: '100%',
        zIndex: 3,
        pointerEvents: 'none',
      }}
      slotProps={{
        paper: {
          'aria-label': 'Row detail',
          sx: {
            position: 'absolute',
            width: '100%',
            pointerEvents: 'auto',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          },
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
          Row detail
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {row ? `row ${row.row}` : ''} · D closes · ↑↓ move rows
        </Typography>
        <IconButton size="small" aria-label="Close row detail" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      {children}
    </Drawer>
  );
}

function NoId({ reason }: { reason: string | null }) {
  return (
    <Alert severity="info" variant="outlined" sx={{ py: 0, fontSize: 13 }}>
      {reason}
    </Alert>
  );
}

/** A heading that folds what's under it, when folding is on. */
function FoldHeading({
  title,
  folded,
  setFolded,
  fold,
  summary,
}: {
  title: string;
  folded: boolean;
  setFolded: (f: boolean) => void;
  fold: boolean;
  summary?: string;
}) {
  if (!fold) {
    return (
      <Typography variant="overline" color="text.secondary" component="h3" sx={{ lineHeight: 2 }}>
        {title}
      </Typography>
    );
  }
  return (
    <Box
      component="button"
      aria-expanded={!folded}
      onClick={() => setFolded(!folded)}
      sx={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        width: '100%',
        color: 'text.secondary',
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
      }}
    >
      <ExpandMore
        fontSize="small"
        sx={{ transform: folded ? 'rotate(-90deg)' : 'none', transition: 'transform 120ms' }}
      />
      <Typography variant="overline" sx={{ lineHeight: 2 }}>
        {title}
      </Typography>
      {summary && (
        <Typography variant="caption" sx={{ ml: 1 }}>
          {summary}
        </Typography>
      )}
    </Box>
  );
}

// --- A: header, fields, comment box and history --------------------------------------------------

function VariantA(p: PanelProps) {
  const id = p.row?.id ?? null;
  const { entries, error, reload } = useHistory(id, p.annotations?.version);
  const [folded, setFolded] = useRemembered('historyFolded');
  return (
    <Shell row={p.row} onClose={p.onClose}>
      <Box
        sx={{
          px: 2,
          py: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'action.hover',
        }}
      >
        {id === null ? (
          <NoId reason={p.reason} />
        ) : (
          <>
            <IdLine id={id} />
            <LabelLine annotations={p.annotations} labels={p.labels} />
            <Tags annotations={p.annotations} />
          </>
        )}
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1 }}>
        <Fields row={p.row} nameWidth={210} s={p.s} />
        {id !== null && (
          <Box component="section" aria-label="Comments and history" sx={{ mt: 2, mb: 8 }}>
            <FoldHeading
              title="Comments and history"
              folded={folded}
              setFolded={setFolded}
              fold={p.s.fold}
              summary={entries ? `${comments(entries)} comments · ${entries.length} entries` : ''}
            />
            {(!p.s.fold || !folded) && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
                <CommentBox
                  id={id}
                  draft={p.draft}
                  setDraft={p.setDraft}
                  onCommented={p.onCommented}
                  onAdded={reload}
                />
                {error && <Alert severity="error">{error}</Alert>}
                {entries && <HistoryList entries={entries} labels={p.labels} />}
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Shell>
  );
}

// --- B: two columns ------------------------------------------------------------------------------

function VariantB(p: PanelProps) {
  const id = p.row?.id ?? null;
  const { entries, error, reload } = useHistory(id, p.annotations?.version);
  const [folded, setFolded] = useRemembered('columnFolded');
  const rail = p.s.fold && folded;
  return (
    <Shell row={p.row} onClose={p.onClose}>
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0, overflowY: 'auto', px: 2, py: 1 }}>
          <Fields row={p.row} nameWidth={150} s={p.s} />
          <Box sx={{ height: 64 }} />
        </Box>
        <Box
          component="section"
          aria-label="Annotations"
          sx={{
            width: rail ? 36 : 340,
            flexShrink: 0,
            borderLeft: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {p.s.fold && (
            <Box
              sx={{
                display: 'flex',
                justifyContent: rail ? 'center' : 'flex-end',
                pt: 0.5,
                pr: rail ? 0 : 0.5,
              }}
            >
              <IconButton
                size="small"
                aria-label={rail ? 'Show annotations' : 'Hide annotations'}
                onClick={() => setFolded(!folded)}
              >
                {rail ? <ChevronLeft fontSize="small" /> : <ChevronRight fontSize="small" />}
              </IconButton>
            </Box>
          )}
          {rail ? (
            p.annotations?.label && (
              <Box
                title={shownLabel(p.annotations.label.key, p.labels).name}
                sx={{
                  mx: 'auto',
                  mt: 1,
                  width: 12,
                  height: 12,
                  borderRadius: '2px',
                  bgcolor: `var(--mui-palette-labelStripe-${shownLabel(p.annotations.label.key, p.labels).colour})`,
                }}
              />
            )
          ) : (
            <Box
              sx={{
                px: 2,
                pb: 8,
                pt: p.s.fold ? 0 : 1.5,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              {id === null ? (
                <NoId reason={p.reason} />
              ) : (
                <>
                  <IdLine id={id} />
                  <LabelLine annotations={p.annotations} labels={p.labels} />
                  <Tags annotations={p.annotations} />
                  <Box sx={{ mt: 1 }}>
                    <CommentBox
                      id={id}
                      draft={p.draft}
                      setDraft={p.setDraft}
                      onCommented={p.onCommented}
                      onAdded={reload}
                    />
                  </Box>
                  {error && <Alert severity="error">{error}</Alert>}
                  {entries && <HistoryList entries={entries} labels={p.labels} />}
                </>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Shell>
  );
}

// --- C: the fields, then all the annotations -----------------------------------------------------

function VariantC(p: PanelProps) {
  const id = p.row?.id ?? null;
  const { entries, error, reload } = useHistory(id, p.annotations?.version);
  const [folded, setFolded] = useRemembered('annotationsFolded');
  const label = p.annotations?.label
    ? shownLabel(p.annotations.label.key, p.labels).name
    : 'No label';
  const tags = p.annotations?.tags?.length ?? 0;
  const summary = `${label} · ${tags} tags · ${comments(entries)} comments`;
  return (
    <Shell row={p.row} onClose={p.onClose}>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1 }}>
        <Fields row={p.row} nameWidth={210} s={p.s} />
        <Box
          component="section"
          aria-label="Annotations"
          sx={{ mt: 2, mb: 8, pt: 1, borderTop: 1, borderColor: 'divider' }}
        >
          {id === null ? (
            <NoId reason={p.reason} />
          ) : (
            <>
              <FoldHeading
                title="Annotations"
                folded={folded}
                setFolded={setFolded}
                fold={p.s.fold}
                summary={p.s.fold && folded ? summary : undefined}
              />
              {(!p.s.fold || !folded) && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 0.5 }}>
                  <IdLine id={id} />
                  <LabelLine annotations={p.annotations} labels={p.labels} />
                  <Tags annotations={p.annotations} />
                  <CommentBox
                    id={id}
                    draft={p.draft}
                    setDraft={p.setDraft}
                    onCommented={p.onCommented}
                    onAdded={reload}
                  />
                  {error && <Alert severity="error">{error}</Alert>}
                  {entries && <HistoryList entries={entries} labels={p.labels} />}
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>
    </Shell>
  );
}
