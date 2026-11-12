// PROTOTYPE: throwaway variants of the Save preset dialog. Not for main.
//
// Four variants of the Save preset dialog, switchable via `?variant=`, in the real action tab:
// A today, B table, C side preview, D compact list. `npm run prototype:save-preset`.
// Every variant but A shares one form state, so switching between B, C and D keeps your edits.
/* eslint-disable react-refresh/only-export-components -- prototype */
import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlined';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import TableRowsOutlinedIcon from '@mui/icons-material/TableRowsOutlined';
import TitleIcon from '@mui/icons-material/Title';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Popover from '@mui/material/Popover';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { Fragment, useRef, useState, type ReactNode } from 'react';
import type { CatalogueAction, Preset, PresetFields } from '../../lib/api';
import { useDeclareStatement } from '../action-tab/declareStatement';
import { isUnset, paramText } from '../action-tab/paramValues';
import {
  bindsByPosition,
  isParametersParam,
  positionLabel,
  queryParameterTypes,
  takesQueryParameters,
  type QueryParameterType,
} from '../action-tab/queryParameters';
import { useInstanceStore } from '../instance';
import {
  canSave,
  formFields,
  initialForm,
  queryParameterErrors,
  rowParams,
  suggestedNames,
  valueOrType,
  type InputMode,
  type QueryParameterForm,
} from './presetForm';
import { usePresetsStore, type PresetsStore } from './presetsStore';

export const SAVE_PRESET_VARIANTS = [
  { key: 'A', name: 'Today' },
  { key: 'B', name: 'Table' },
  { key: 'C', name: 'Side preview' },
  { key: 'D', name: 'Compact list' },
  { key: 'E', name: 'B + title template' },
  { key: 'F', name: 'B + title tokens' },
];

export interface DialogProps {
  action: CatalogueAction;
  params: Record<string, unknown>;
  source?: Preset;
  idColumn?: string | null;
  onClose: () => void;
  onSaved?: (preset: Preset) => void;
  store?: PresetsStore;
}

// ---------------------------------------------------------------------------------------------
// Shared state: the same form logic as today's dialog, lifted so variants only differ in layout.

export function useDialogState({
  action,
  params,
  source,
  idColumn = null,
  onClose,
  onSaved,
  store = usePresetsStore,
}: DialogProps) {
  const [form, setForm] = useState(() => initialForm(action, params, source));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** E and F: the tab title with `{Input}` placeholders; null until edited, so it follows the name. */
  const [titleTemplate, setTitleTemplate] = useState<string | null>(null);
  const bound = bindsByPosition(action.params);
  const fetched = useDeclareStatement(action.key, form.queryParameters);
  // PROTOTYPE: dev_rows declares nothing, so make up the Kusto one to see how it reads.
  const declareStatement =
    fetched ||
    (form.queryParameters.length > 0 && !bound
      ? `declare query_parameters(${form.queryParameters.map((q) => `${q.name || '?'}:${q.type}`).join(', ')});`
      : undefined);
  const presets = store((s) => s.presets);
  const actions = useInstanceStore((s) => s.instance?.actions ?? []);
  const setQueryParameters = (change: (all: QueryParameterForm[]) => QueryParameterForm[]) =>
    setForm((f) => ({ ...f, queryParameters: change(f.queryParameters) }));
  const save = async (write: (fields: PresetFields) => Promise<Preset>) => {
    setSaving(true);
    setError(null);
    try {
      const preset = await write(formFields(action, params, form, idColumn));
      onSaved?.(preset);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };
  return {
    titleTemplate,
    setTitleTemplate,
    action,
    params,
    source,
    onClose,
    store,
    form,
    setForm,
    saving,
    error,
    save,
    bound,
    types: queryParameterTypes(action),
    suggestions: suggestedNames(action, params, form),
    declareStatement,
    folders: folderTree([
      ...actions.map((a) => a.menuPath ?? []),
      ...presets.map((p) => p.menuPath ?? []),
      folderPath(form.folder),
    ]),
    setQueryParameters,
    addQueryParameter: () =>
      setQueryParameters((all) => [
        ...all,
        { name: '', type: 'string', fixed: true, showInTitle: false, value: '', columns: '' },
      ]),
  };
}
type State = ReturnType<typeof useDialogState>;

/** One param rows can fill, or one query parameter: what every variant lays out. */
interface InputRow {
  key: string;
  label: string;
  qpIndex?: number;
  fixed: boolean;
  /** Fixed: the value as text, or its placeholder. */
  fixedText: string;
  /** Fixed and unset: nothing goes in the title. */
  unset: boolean;
  columns: string[];
  columnOptions: string[];
  /** Takes every selected row's value, not one they agree on. */
  showInTitle: boolean;
  setFixed: (fixed: boolean) => void;
  setColumns: (columns: string[]) => void;
  setShowInTitle: (show: boolean) => void;
}

const splitColumns = (text: string) =>
  text
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c !== '');

function inputRows(s: State): InputRow[] {
  const { action, params, form, setForm, setQueryParameters } = s;
  const setMode = (name: string, mode: InputMode) =>
    setForm((f) => ({ ...f, modes: { ...f.modes, [name]: mode } }));
  const fromParams = rowParams(action).map((p): InputRow => {
    const mode = form.modes[p.name] ?? { fixed: true, columns: [], showInTitle: false };
    const all = p.fromColumns ?? [];
    return {
      key: p.name,
      label: p.title,
      fixed: mode.fixed,
      fixedText: valueOrType(p, params[p.name]),
      unset: isUnset(params[p.name]),
      columns: mode.columns,
      columnOptions: all,
      showInTitle: mode.showInTitle,
      setFixed: (fixed) =>
        setMode(p.name, {
          fixed,
          columns: mode.columns.length > 0 ? mode.columns : all,
          showInTitle: !fixed,
        }),
      setColumns: (columns) =>
        setMode(p.name, { ...mode, columns: all.filter((c) => columns.includes(c)) }),
      setShowInTitle: (showInTitle) => setMode(p.name, { ...mode, showInTitle }),
    };
  });
  const change = (i: number, changes: Partial<QueryParameterForm>) =>
    setQueryParameters((all) => all.map((qp, j) => (j === i ? { ...qp, ...changes } : qp)));
  const fromQuery = form.queryParameters.map((qp, i): InputRow => ({
    key: `qp-${i}`,
    label: qp.name || `Query parameter ${i + 1}`,
    qpIndex: i,
    fixed: qp.fixed,
    fixedText: qp.value === '' ? `<${qp.type}>` : qp.value,
    unset: qp.value === '',
    columns: splitColumns(qp.columns),
    columnOptions: [],
    showInTitle: qp.showInTitle,
    setFixed: (fixed) => change(i, { fixed, showInTitle: !fixed }),
    setColumns: (columns) => change(i, { columns: columns.join(', ') }),
    setShowInTitle: (showInTitle) => change(i, { showInTitle }),
  }));
  return [...fromParams, ...fromQuery];
}

/** The params saved as they are: neither rows nor the query fill them. */
function keptParams({ action, params }: State): { title: string; text: string }[] {
  const rows = new Set(rowParams(action).map((p) => p.name));
  return action.params
    .filter(
      (p) =>
        !rows.has(p.name) &&
        !isParametersParam(p) &&
        p.kind !== 'kql' &&
        p.kind !== 'sql' &&
        !isUnset(params[p.name]),
    )
    .map((p) => ({ title: p.title, text: paramText(params[p.name]) }));
}

const queryText = ({ action, params }: State): string | undefined => {
  const p = action.params.find((q) => q.kind === 'kql' || q.kind === 'sql');
  if (!p) return undefined;
  const v = params[p.name];
  return typeof v === 'string' && v.trim() !== '' ? v : '';
};

/** The words of the tab title: the name, then each input shown in it. */
const titleParts = (s: State, rows: InputRow[]) => [
  { text: s.form.name || 'Untitled', placeholder: false },
  ...rows
    .filter((r) => r.showInTitle && !(r.fixed && r.unset))
    .map((r) =>
      r.fixed
        ? { text: r.fixedText, placeholder: false }
        : { text: r.columns[0] ?? r.label, placeholder: true },
    ),
];

// ---------------------------------------------------------------------------------------------
// Folders: the menu tree from the instance's actions and the presets.

type FolderTree = Map<string, FolderTree>;
const folderPath = (folder: string) =>
  folder
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '');
const folderText = (path: string[]) => path.join(' / ');

function folderTree(paths: string[][]): FolderTree {
  const root: FolderTree = new Map();
  for (const path of paths) {
    let node = root;
    for (const seg of path) {
      if (!node.has(seg)) node.set(seg, new Map());
      node = node.get(seg)!;
    }
  }
  return root;
}
function childrenAt(tree: FolderTree, prefix: string[]): string[] {
  let node: FolderTree | undefined = tree;
  for (const seg of prefix) node = node?.get(seg);
  return [...(node?.keys() ?? [])];
}

// ---------------------------------------------------------------------------------------------
// Small shared pieces.

/** The query as an editor shows it: line numbers, and the declare statement TIM adds marked. */
function QueryCode({ declare, query }: { declare?: string; query: string }) {
  const lines = [
    ...(declare ? [{ text: declare, added: true }] : []),
    ...(query === '' ? [{ text: '// no query yet', added: false }] : []),
    ...query.split('\n').map((text) => ({ text, added: false })),
  ].filter((l, i, all) => !(query === '' && i === all.length - 1 && l.text === ''));
  const code = (
    <Box
      sx={{
        bgcolor: '#1e1e1e',
        color: '#d4d4d4',
        borderRadius: 1,
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: 13,
        lineHeight: '20px',
        py: 1,
        overflowX: 'auto',
        maxHeight: 220,
      }}
    >
      {lines.map((l, i) => (
        <Box
          key={i}
          sx={{
            display: 'flex',
            bgcolor: l.added ? 'rgba(86,156,214,0.15)' : undefined,
            borderLeft: '3px solid',
            borderColor: l.added ? '#569cd6' : 'transparent',
          }}
        >
          <Box
            component="span"
            sx={{ width: 36, flexShrink: 0, textAlign: 'right', pr: 1.5, color: '#6e7681' }}
          >
            {i + 1}
          </Box>
          <Box
            component="span"
            sx={{ whiteSpace: 'pre', flex: 1, color: l.added ? '#9cdcfe' : undefined }}
          >
            {l.text}
          </Box>
        </Box>
      ))}
    </Box>
  );
  return (
    <Box>
      {code}
      {declare && (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mt: 0.5 }}>
          <Box sx={{ width: 10, height: 10, bgcolor: '#569cd6', borderRadius: 0.5 }} />
          <Typography variant="caption" color="text.secondary">
            Line 1 is added from the query parameters
          </Typography>
        </Stack>
      )}
    </Box>
  );
}

/** Columns of the clicked row as chips: picked from the param's columns, or typed. */
function ColumnsField({ row, size = 'small' }: { row: InputRow; size?: 'small' | 'medium' }) {
  return (
    <Autocomplete
      multiple
      freeSolo={row.columnOptions.length === 0}
      autoSelect
      size={size}
      limitTags={2}
      options={row.columnOptions}
      value={row.columns}
      onChange={(_, columns) => row.setColumns(columns)}
      renderValue={(value, getItemProps) =>
        value.map((option, index) => {
          const { key, ...props } = getItemProps({ index });
          return <Chip key={key} size="small" label={option} {...props} />;
        })
      }
      renderInput={(input) => (
        <TextField
          {...input}
          size="small"
          aria-label={`${row.label} columns`}
          placeholder={row.columns.length === 0 ? 'None: asked for when opened' : undefined}
        />
      )}
      sx={{
        flex: 1,
        minWidth: 0,
        '& .MuiAutocomplete-inputRoot': { flexWrap: 'nowrap', overflow: 'hidden' },
      }}
    />
  );
}

function QueryParameterName({ s, index, width }: { s: State; index: number; width?: number }) {
  const qp = s.form.queryParameters[index]!;
  const error = queryParameterErrors(s.form, index).name;
  return (
    <Tooltip title={error ?? ''} placement="top">
      <Autocomplete
        freeSolo
        openOnFocus
        size="small"
        options={s.suggestions}
        inputValue={qp.name}
        onInputChange={(_, name) =>
          s.setQueryParameters((all) => all.map((q, j) => (j === index ? { ...q, name } : q)))
        }
        sx={{ width: width ?? '100%' }}
        renderInput={(input) => (
          <TextField
            {...input}
            size="small"
            placeholder="name"
            autoFocus={qp.name === ''}
            error={error !== undefined}
            slotProps={{
              ...input.slotProps,
              input: {
                ...input.slotProps.input,
                startAdornment: (
                  <InputAdornment position="start" sx={{ fontFamily: 'monospace', mr: 0.5 }}>
                    {positionLabel(index, s.bound)}
                  </InputAdornment>
                ),
              },
            }}
          />
        )}
      />
    </Tooltip>
  );
}

function QueryParameterType({ s, index, width }: { s: State; index: number; width?: number }) {
  const qp = s.form.queryParameters[index]!;
  return (
    <TextField
      select
      size="small"
      aria-label="Type"
      value={qp.type}
      onChange={(e) =>
        s.setQueryParameters((all) =>
          all.map((q, j) =>
            j === index ? { ...q, type: e.target.value as QueryParameterType } : q,
          ),
        )
      }
      sx={{ width: width ?? '100%' }}
    >
      {s.types.map((t) => (
        <MenuItem key={t} value={t} dense>
          {t}
        </MenuItem>
      ))}
    </TextField>
  );
}

function QueryParameterValue({ s, index }: { s: State; index: number }) {
  const qp = s.form.queryParameters[index]!;
  const error = queryParameterErrors(s.form, index).value;
  return (
    <Tooltip title={error ?? ''} placement="top">
      <TextField
        size="small"
        fullWidth
        placeholder={`<${qp.type}>`}
        value={qp.value}
        error={error !== undefined}
        onChange={(e) =>
          s.setQueryParameters((all) =>
            all.map((q, j) => (j === index ? { ...q, value: e.target.value } : q)),
          )
        }
      />
    </Tooltip>
  );
}

function MoveRemove({ s, index }: { s: State; index: number }) {
  const n = s.form.queryParameters.length;
  const move = (to: number) =>
    s.setQueryParameters((all) => {
      const moved = [...all];
      [moved[index], moved[to]] = [moved[to]!, moved[index]!];
      return moved;
    });
  return (
    <Stack direction="row" sx={{ flexShrink: 0 }}>
      <IconButton
        size="small"
        aria-label="Move up"
        disabled={index === 0}
        onClick={() => move(index - 1)}
      >
        <ArrowUpwardIcon fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        aria-label="Move down"
        disabled={index === n - 1}
        onClick={() => move(index + 1)}
      >
        <ArrowDownwardIcon fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        aria-label="Remove"
        onClick={() => s.setQueryParameters((all) => all.filter((_, j) => j !== index))}
      >
        <DeleteOutlineIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

function Actions({ s }: { s: State }) {
  const owned = s.source !== undefined && s.source.owned;
  const off = s.saving || !canSave(s.form);
  const create = () => s.save((fields) => s.store.getState().create(fields));
  return (
    <DialogActions>
      {s.error && (
        <Typography color="error" role="alert" sx={{ mr: 'auto', pl: 2 }}>
          Couldn't save: {s.error}
        </Typography>
      )}
      <Button onClick={s.onClose}>Cancel</Button>
      {owned ? (
        <>
          <Button disabled={off} onClick={() => void create()}>
            Save as new
          </Button>
          <Button
            variant="contained"
            disabled={off}
            onClick={() => void s.save((f) => s.store.getState().replace(s.source!.presetId, f))}
          >
            Update "{s.source!.name}"
          </Button>
        </>
      ) : (
        <Button variant="contained" disabled={off} onClick={() => void create()}>
          Save
        </Button>
      )}
    </DialogActions>
  );
}

const Section = ({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) => (
  <Box>
    <Stack direction="row" sx={{ alignItems: 'center', mb: 0.75, minHeight: 30 }}>
      <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1, flex: 1 }}>
        {title}
      </Typography>
      {action}
    </Stack>
    {children}
  </Box>
);

const errorsOf = (s: State) =>
  s.form.queryParameters.flatMap((qp, i) => {
    const e = queryParameterErrors(s.form, i);
    return [e.name, e.value]
      .filter((m): m is string => m !== undefined)
      .map((m) => `${qp.name || `Query parameter ${i + 1}`}: ${m}`);
  });

// ---------------------------------------------------------------------------------------------
// B: Table. Folder as chips with › between. One "In title" column. Preview = title + query.

function FolderChips({ s }: { s: State }) {
  const path = folderPath(s.form.folder);
  return (
    <Autocomplete
      multiple
      freeSolo
      autoSelect
      options={childrenAt(s.folders, path)}
      value={path}
      onChange={(_, value) => s.setForm((f) => ({ ...f, folder: folderText(value) }))}
      renderValue={(value, getItemProps) =>
        value.map((option, index) => {
          const { key, ...props } = getItemProps({ index });
          return (
            <Fragment key={key}>
              {index > 0 && <ChevronRightIcon fontSize="small" sx={{ color: 'text.disabled' }} />}
              <Chip size="small" icon={<FolderOutlinedIcon />} label={option} {...props} />
            </Fragment>
          );
        })
      }
      renderInput={(input) => (
        <TextField
          {...input}
          label="Folder in the New menu"
          placeholder={path.length === 0 ? 'Top level' : 'Subfolder…'}
          helperText="Pick or type a folder, Enter for each level"
        />
      )}
      sx={{ flex: 1 }}
    />
  );
}

/** Fixed or From row, each option saying what it will do for this input. */
/** The same for every input, so an analyst learns it once. */
const FIXED_HINT: [string, string][] = [
  ['Value', 'saved with the preset, as it is now'],
  ['Tabs', 'every tab opened from the preset starts with it'],
];
const ROW_HINT: [string, string][] = [
  ['Value', 'the first of its columns with a value in the row'],
  ['Several rows', 'must match, unless the input takes a list'],
  ['Right-click', 'offered on rows that have one of its columns'],
  ['New menu', 'the tab asks for it'],
];

function SourceSelect({ r }: { r: InputRow }) {
  const lines = (hint: [string, string][]) => (
    <Box
      component="span"
      sx={{
        display: 'grid',
        gridTemplateColumns: '84px 1fr',
        columnGap: 1.5,
        rowGap: 0.25,
        mt: 0.5,
      }}
    >
      {hint.map(([k, v]) => (
        <Fragment key={k}>
          <Box component="span" sx={{ color: 'text.primary', whiteSpace: 'nowrap' }}>
            {k}
          </Box>
          <span>{v}</span>
        </Fragment>
      ))}
    </Box>
  );
  const item = { alignItems: 'flex-start', whiteSpace: 'normal', py: 1 } as const;
  return (
    <TextField
      select
      size="small"
      fullWidth
      aria-label={`${r.label} value`}
      value={r.fixed ? 'fixed' : 'row'}
      onChange={(e) => r.setFixed(e.target.value === 'fixed')}
      slotProps={{
        select: {
          renderValue: (v) => (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              {v === 'fixed' ? (
                <PushPinOutlinedIcon sx={{ fontSize: 18 }} color="action" />
              ) : (
                <TableRowsOutlinedIcon sx={{ fontSize: 18 }} color="primary" />
              )}
              <span>{v === 'fixed' ? 'Fixed' : 'From row'}</span>
            </Stack>
          ),
          MenuProps: { slotProps: { paper: { sx: { maxWidth: 480 } } } },
        },
      }}
    >
      <MenuItem value="fixed" sx={item}>
        <ListItemIcon sx={{ mt: 0.25 }}>
          <PushPinOutlinedIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Fixed" secondary={lines(FIXED_HINT)} />
      </MenuItem>
      <MenuItem value="row" sx={item}>
        <ListItemIcon sx={{ mt: 0.25 }}>
          <TableRowsOutlinedIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="From row" secondary={lines(ROW_HINT)} />
      </MenuItem>
    </TextField>
  );
}

// ---------------------------------------------------------------------------------------------
// E and F: the tab title as a template with `{Input}` placeholders, instead of a switch per input.

type TitleSegment = { text: string } | { placeholder: string };
const PLACEHOLDER = /\{([^{}]*)\}/g;
function titleSegments(template: string): TitleSegment[] {
  const out: TitleSegment[] = [];
  let at = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    if (m.index > at) out.push({ text: template.slice(at, m.index) });
    out.push({ placeholder: m[1]! });
    at = m.index + m[0].length;
  }
  if (at < template.length) out.push({ text: template.slice(at) });
  return out;
}
const placeholderOf = (r: InputRow) => `{${r.label}}`;

function useTitleTemplate(s: State, rows: InputRow[]) {
  const template =
    s.titleTemplate ??
    [s.form.name, ...rows.filter((r) => r.showInTitle).map(placeholderOf)].join(' ');
  /** PROTOTYPE: saves as today, an input is in the title when its placeholder is. */
  const set = (next: string) => {
    s.setTitleTemplate(next);
    for (const r of rows) {
      const want = next.includes(placeholderOf(r));
      if (want !== r.showInTitle) r.setShowInTitle(want);
    }
  };
  return [template, set] as const;
}

/** The title as a tab would show it: fixed values filled in, row values as placeholders. */
function TitlePreview({ template, rows }: { template: string; rows: InputRow[] }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mt: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
        Opens as
      </Typography>
      <Typography
        noWrap
        sx={{
          px: 1.5,
          py: 0.5,
          border: 1,
          borderColor: 'divider',
          borderBottom: 3,
          borderBottomColor: 'primary.main',
          borderRadius: '4px 4px 0 0',
          minWidth: 0,
        }}
      >
        {titleSegments(template).map((seg, i) => {
          if ('text' in seg) return <span key={i}>{seg.text}</span>;
          const r = rows.find((x) => x.label === seg.placeholder);
          if (!r)
            return (
              <Box key={i} component="span" sx={{ color: 'error.main' }}>
                {`{${seg.placeholder}?}`}
              </Box>
            );
          if (r.fixed)
            return r.unset ? (
              <Box key={i} component="span" sx={{ color: 'text.disabled' }} title="Unset: left out">
                ∅
              </Box>
            ) : (
              <span key={i}>{r.fixedText}</span>
            );
          return (
            <Box key={i} component="span" sx={{ color: 'primary.main', fontStyle: 'italic' }}>
              ‹{r.columns[0] ?? r.label}›
            </Box>
          );
        })}
      </Typography>
    </Stack>
  );
}

/** E: free text, placeholders highlighted where they are, `{` suggests inputs, chips insert them. */
function TitleTemplateField({ s, rows }: { s: State; rows: InputRow[] }) {
  const [template, setTemplate] = useTitleTemplate(s, rows);
  const ref = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const before = caret === null ? '' : template.slice(0, caret);
  const open = before.lastIndexOf('{') > before.lastIndexOf('}') ? before.lastIndexOf('{') : -1;
  const typed = open >= 0 ? before.slice(open + 1).toLowerCase() : '';
  const matches = open >= 0 ? rows.filter((r) => r.label.toLowerCase().includes(typed)) : [];
  const insert = (r: InputRow, from: number, to: number) => {
    const text = placeholderOf(r);
    const next = template.slice(0, from) + text + template.slice(to);
    setTemplate(next);
    const at = from + text.length;
    setCaret(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(at, at);
    });
  };
  const track = () => setCaret(ref.current?.selectionStart ?? null);
  const known = new Set(rows.map((r) => r.label));
  return (
    <Box>
      <Box sx={{ position: 'relative' }}>
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            p: '16.5px 14px',
            typography: 'body1',
            lineHeight: '1.4375em',
            whiteSpace: 'pre',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {titleSegments(template).map((seg, i) =>
            'text' in seg ? (
              <span key={i}>{seg.text}</span>
            ) : (
              <Box
                key={i}
                component="span"
                sx={{
                  borderRadius: 0.5,
                  bgcolor: known.has(seg.placeholder)
                    ? 'rgba(25,118,210,0.14)'
                    : 'rgba(211,47,47,0.14)',
                  boxShadow: `0 0 0 2px ${known.has(seg.placeholder) ? 'rgba(25,118,210,0.14)' : 'rgba(211,47,47,0.14)'}`,
                  color: known.has(seg.placeholder) ? 'primary.dark' : 'error.main',
                }}
              >{`{${seg.placeholder}}`}</Box>
            ),
          )}
        </Box>
        <TextField
          fullWidth
          label="Tab title"
          helperText={`e.g. ${s.form.name || 'Sign-ins'} for {${rows[0]?.label ?? 'Users'}}${rows[1] ? ` on {${rows[1].label}}` : ''}`}
          value={template}
          inputRef={ref}
          onChange={(e) => {
            setTemplate(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={track}
          onBlur={() => setTimeout(() => setCaret(null), 150)}
          onKeyDown={(e) => {
            if (matches.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) {
              e.preventDefault();
              insert(matches[0]!, open, caret!);
            }
            if (open >= 0 && e.key === 'Escape') {
              e.stopPropagation();
              setCaret(null);
            }
          }}
          sx={{ '& input': { color: 'transparent', caretColor: (t) => t.palette.text.primary } }}
        />
        {matches.length > 0 && (
          <Paper
            elevation={6}
            sx={{ position: 'absolute', top: '100%', left: 0, zIndex: 2, mt: 0.5, minWidth: 220 }}
          >
            <List dense disablePadding>
              {matches.map((r, i) => (
                <ListItemButton
                  key={r.key}
                  selected={i === 0}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insert(r, open, caret!);
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    {r.fixed ? (
                      <PushPinOutlinedIcon fontSize="small" />
                    ) : (
                      <TableRowsOutlinedIcon fontSize="small" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={r.label}
                    secondary={r.fixed ? r.fixedText : `row's ${r.columns.join(' or ') || 'asked'}`}
                  />
                </ListItemButton>
              ))}
            </List>
          </Paper>
        )}
      </Box>
    </Box>
  );
}

/** F: the title as tokens: words you type, and inputs picked from the list as chips. */
function TitleTokensField({ s, rows }: { s: State; rows: InputRow[] }) {
  const [template, setTemplate] = useTitleTemplate(s, rows);
  const [input, setInput] = useState('');
  const tokens = titleSegments(template).flatMap((seg) =>
    'text' in seg ? seg.text.split(/\s+/).filter((w) => w !== '') : [`{${seg.placeholder}}`],
  );
  const set = (next: string[]) => setTemplate(next.join(' '));
  const isInput = (t: string) => t.startsWith('{') && t.endsWith('}');
  return (
    <Box>
      <Autocomplete
        multiple
        freeSolo
        disableCloseOnSelect
        options={rows.map(placeholderOf)}
        value={tokens}
        inputValue={input}
        onInputChange={(_, v, reason) => {
          if (reason === 'input' && v.endsWith(' ') && v.trim() !== '') {
            set([...tokens, ...v.trim().split(/\s+/)]);
            setInput('');
          } else setInput(v);
        }}
        onChange={(_, v) => set(v.flatMap((t) => (isInput(t) ? [t] : t.trim().split(/\s+/))))}
        getOptionLabel={(o) => (isInput(o) ? o.slice(1, -1) : o)}
        renderOption={(props, o) => {
          const { key, ...rest } = props;
          const r = rows.find((x) => placeholderOf(x) === o);
          return (
            <li key={key} {...rest}>
              <ListItemIcon sx={{ minWidth: 28 }}>
                {r?.fixed ? (
                  <PushPinOutlinedIcon fontSize="small" />
                ) : (
                  <TableRowsOutlinedIcon fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText
                primary={o.slice(1, -1)}
                secondary={
                  r
                    ? r.fixed
                      ? r.fixedText
                      : `row's ${r.columns.join(' or ') || 'asked'}`
                    : undefined
                }
              />
            </li>
          );
        }}
        renderValue={(value, getItemProps) =>
          value.map((t, index) => {
            const { key, ...props } = getItemProps({ index });
            return isInput(t) ? (
              <Chip key={key} size="small" color="primary" label={t.slice(1, -1)} {...props} />
            ) : (
              <Chip
                key={key}
                size="small"
                label={t}
                {...props}
                sx={{
                  bgcolor: 'transparent',
                  '& .MuiChip-label': { px: 0.25, fontSize: 15 },
                  '& .MuiChip-deleteIcon': { display: 'none' },
                }}
              />
            );
          })
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label="Tab title"
            placeholder={tokens.length === 0 ? 'Type words, pick inputs' : undefined}
            helperText="Type words; pick an input from the list to put its value in. Backspace removes the last."
          />
        )}
      />
      <TitlePreview template={template} rows={rows} />
    </Box>
  );
}

function VariantB({
  s,
  title = 'switches',
}: {
  s: State;
  title?: 'switches' | 'template' | 'tokens';
}) {
  const rows = inputRows(s);
  const query = queryText(s);
  const kept = keptParams(s);
  const errors = errorsOf(s);
  const switches = title === 'switches';
  const cols = switches
    ? '150px 108px 136px minmax(0,1fr) 64px 96px'
    : '150px 108px 136px minmax(0,1fr) 96px';
  const cell = { display: 'flex', alignItems: 'center', minWidth: 0 } as const;
  return (
    <Dialog open onClose={s.onClose} fullWidth maxWidth="md">
      <DialogTitle>Save preset</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
            <TextField
              label="Name"
              value={s.form.name}
              onChange={(e) => s.setForm((f) => ({ ...f, name: e.target.value }))}
              sx={{ width: 260 }}
            />
            <FolderChips s={s} />
          </Stack>
          <FormControlLabel
            label="Share with everyone"
            control={
              <Switch
                checked={s.form.visibility === 'shared'}
                onChange={(e) =>
                  s.setForm((f) => ({ ...f, visibility: e.target.checked ? 'shared' : 'private' }))
                }
              />
            }
          />
          <Section
            title="Inputs"
            action={
              takesQueryParameters(s.action) && (
                <Button size="small" startIcon={<AddIcon />} onClick={s.addQueryParameter}>
                  Query parameter
                </Button>
              )
            }
          >
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: cols,
                  columnGap: 1,
                  px: 1.5,
                  py: 0.75,
                  bgcolor: 'action.hover',
                  typography: 'caption',
                  color: 'text.secondary',
                  fontWeight: 600,
                }}
              >
                <span>Input</span>
                <span>Type</span>
                <span>Value</span>
                <span />
                {switches && <Box sx={{ textAlign: 'center' }}>In title</Box>}
                <span />
              </Box>
              {rows.map((r) => (
                <Box
                  key={r.key}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: cols,
                    columnGap: 1,
                    px: 1.5,
                    height: 52,
                    borderTop: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Box sx={cell}>
                    {r.qpIndex === undefined ? (
                      <Typography noWrap>{r.label}</Typography>
                    ) : (
                      <QueryParameterName s={s} index={r.qpIndex} />
                    )}
                  </Box>
                  <Box sx={cell}>
                    {r.qpIndex === undefined ? (
                      <Typography variant="body2" color="text.secondary">
                        param
                      </Typography>
                    ) : (
                      <QueryParameterType s={s} index={r.qpIndex} />
                    )}
                  </Box>
                  <Box sx={cell}>
                    <SourceSelect r={r} />
                  </Box>
                  <Box
                    sx={{
                      ...cell,
                      // E and F: a param has no actions, so its value runs to the row's end.
                      gridColumn: !switches && r.qpIndex === undefined ? 'span 2' : undefined,
                    }}
                  >
                    {!r.fixed ? (
                      <ColumnsField row={r} />
                    ) : r.qpIndex !== undefined ? (
                      <QueryParameterValue s={s} index={r.qpIndex} />
                    ) : (
                      <Typography
                        noWrap
                        variant="body2"
                        title={r.fixedText}
                        sx={{
                          fontFamily: 'monospace',
                          color: r.unset ? 'text.disabled' : undefined,
                        }}
                      >
                        {r.fixedText}
                      </Typography>
                    )}
                  </Box>
                  {switches && (
                    <Box sx={{ ...cell, justifyContent: 'center' }}>
                      <Switch
                        size="small"
                        checked={r.showInTitle}
                        onChange={(e) => r.setShowInTitle(e.target.checked)}
                        slotProps={{ input: { 'aria-label': `Show ${r.label} in title` } }}
                      />
                    </Box>
                  )}
                  {(switches || r.qpIndex !== undefined) && (
                    <Box sx={{ ...cell, justifyContent: 'flex-end' }}>
                      {r.qpIndex !== undefined && <MoveRemove s={s} index={r.qpIndex} />}
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
            {kept.length > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Also saved: {kept.map((k) => `${k.title} ${k.text}`).join(' · ')}
              </Typography>
            )}
            {errors.map((e) => (
              <Typography key={e} variant="body2" color="error">
                {e}
              </Typography>
            ))}
          </Section>
          {title === 'template' && <TitleTemplateField s={s} rows={rows} />}
          {title === 'tokens' && <TitleTokensField s={s} rows={rows} />}
          {switches && (
            <Section title="Tab title">
              <Typography
                sx={{
                  display: 'inline-block',
                  px: 1.5,
                  py: 0.75,
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                }}
              >
                {titleParts(s, rows).map((p, i) => (
                  <Box
                    key={i}
                    component="span"
                    sx={p.placeholder ? { color: 'primary.main', fontStyle: 'italic' } : undefined}
                  >
                    {i > 0 && ' '}
                    {p.placeholder ? `‹${p.text}›` : p.text}
                  </Box>
                ))}
              </Typography>
            </Section>
          )}
          {query !== undefined && (
            <Section title="Query">
              <QueryCode declare={s.declareStatement} query={query} />
            </Section>
          )}
        </Stack>
      </DialogContent>
      <Actions s={s} />
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// C: Side preview. Form left, a live "what you'll get" panel right where the title is built.

function FolderTreePicker({ s }: { s: State }) {
  const selected = folderPath(s.form.folder);
  const [adding, setAdding] = useState('');
  const select = (path: string[]) => s.setForm((f) => ({ ...f, folder: folderText(path) }));
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  const render = (tree: FolderTree, prefix: string[]): ReactNode[] =>
    [...tree.entries()].flatMap(([name, children]) => {
      const path = [...prefix, name];
      const onPath = selected.length >= path.length && same(selected.slice(0, path.length), path);
      return [
        <ListItemButton
          key={folderText(path)}
          dense
          selected={same(path, selected)}
          onClick={() => select(path)}
          sx={{ pl: 1 + prefix.length * 2, py: 0.25 }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <FolderOutlinedIcon fontSize="small" color={onPath ? 'primary' : undefined} />
          </ListItemIcon>
          <ListItemText primary={name} />
        </ListItemButton>,
        ...(onPath ? render(children, path) : []),
      ];
    });
  const add = () => {
    if (adding.trim() === '') return;
    select([...selected, adding.trim()]);
    setAdding('');
  };
  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        Folder in the New menu
      </Typography>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <List dense disablePadding sx={{ maxHeight: 168, overflow: 'auto' }}>
          <ListItemButton
            dense
            selected={selected.length === 0}
            onClick={() => select([])}
            sx={{ py: 0.25 }}
          >
            <ListItemText
              primary="Top level"
              slotProps={{ primary: { color: 'text.secondary' } }}
            />
          </ListItemButton>
          {render(s.folders, [])}
        </List>
        <Divider />
        <Stack direction="row" spacing={1} sx={{ p: 1, alignItems: 'center' }}>
          <CreateNewFolderOutlinedIcon fontSize="small" color="action" />
          <TextField
            size="small"
            variant="standard"
            placeholder={`New folder in ${selected.at(-1) ?? 'the top level'}`}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            sx={{ flex: 1 }}
          />
          <Button size="small" disabled={adding.trim() === ''} onClick={add}>
            Add
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}

function SourceCard({ s, r }: { s: State; r: InputRow }) {
  const qp = r.qpIndex;
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, minHeight: 40 }}>
        {qp === undefined ? (
          <Typography sx={{ flex: 1, fontWeight: 500 }} noWrap>
            {r.label}
          </Typography>
        ) : (
          <Stack direction="row" spacing={1} sx={{ flex: 1 }}>
            <QueryParameterName s={s} index={qp} width={170} />
            <QueryParameterType s={s} index={qp} width={110} />
          </Stack>
        )}
        <TextField
          select
          size="small"
          aria-label={`${r.label} value`}
          value={r.fixed ? 'fixed' : 'row'}
          onChange={(e) => r.setFixed(e.target.value === 'fixed')}
          sx={{ width: 230, flexShrink: 0 }}
          slotProps={{
            select: {
              renderValue: (v) => (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  {v === 'fixed' ? (
                    <PushPinOutlinedIcon fontSize="small" />
                  ) : (
                    <TableRowsOutlinedIcon fontSize="small" />
                  )}
                  <span>{v === 'fixed' ? 'Fixed value' : 'From the clicked row'}</span>
                </Stack>
              ),
            },
          }}
        >
          <MenuItem value="fixed">
            <ListItemIcon>
              <PushPinOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Fixed value" secondary="Always the value saved now" />
          </MenuItem>
          <MenuItem value="row">
            <ListItemIcon>
              <TableRowsOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="From the clicked row" secondary="Read from its columns" />
          </MenuItem>
        </TextField>
        {qp !== undefined && <MoveRemove s={s} index={qp} />}
      </Stack>
      <Box sx={{ minHeight: 34, display: 'flex', alignItems: 'center' }}>
        {r.fixed ? (
          qp !== undefined ? (
            <QueryParameterValue s={s} index={qp} />
          ) : (
            <Typography
              variant="body2"
              noWrap
              sx={{ fontFamily: 'monospace', color: r.unset ? 'text.disabled' : 'text.secondary' }}
            >
              {r.fixedText}
            </Typography>
          )
        ) : r.columnOptions.length > 0 ? (
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
              Columns
            </Typography>
            {r.columnOptions.map((c) => {
              const on = r.columns.includes(c);
              return (
                <Chip
                  key={c}
                  size="small"
                  label={c}
                  color={on ? 'primary' : 'default'}
                  variant={on ? 'filled' : 'outlined'}
                  onClick={() =>
                    r.setColumns(on ? r.columns.filter((x) => x !== c) : [...r.columns, c])
                  }
                />
              );
            })}
            {r.columns.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                none: asked for when opened
              </Typography>
            )}
          </Stack>
        ) : (
          <ColumnsField row={r} />
        )}
      </Box>
    </Paper>
  );
}

function VariantC({ s }: { s: State }) {
  const rows = inputRows(s);
  const query = queryText(s);
  const kept = keptParams(s);
  const path = folderPath(s.form.folder);
  return (
    <Dialog open onClose={s.onClose} fullWidth maxWidth="lg">
      <DialogTitle>Save preset</DialogTitle>
      <DialogContent
        sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,7fr) minmax(0,5fr)', gap: 3 }}
      >
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <TextField
            label="Name"
            value={s.form.name}
            onChange={(e) => s.setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Stack direction="row" spacing={2}>
            <Box sx={{ flex: 1 }}>
              <FolderTreePicker s={s} />
            </Box>
            <Box sx={{ width: 200 }}>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                Who sees it
              </Typography>
              <ToggleButtonGroup
                orientation="vertical"
                exclusive
                fullWidth
                size="small"
                value={s.form.visibility}
                onChange={(_, v: Preset['visibility'] | null) =>
                  v && s.setForm((f) => ({ ...f, visibility: v }))
                }
              >
                <ToggleButton value="private" sx={{ justifyContent: 'flex-start', gap: 1 }}>
                  <PersonOutlineIcon fontSize="small" /> Only me
                </ToggleButton>
                <ToggleButton value="shared" sx={{ justifyContent: 'flex-start', gap: 1 }}>
                  <GroupsOutlinedIcon fontSize="small" /> Everyone
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Stack>
          <Section
            title="Inputs"
            action={
              takesQueryParameters(s.action) && (
                <Button size="small" startIcon={<AddIcon />} onClick={s.addQueryParameter}>
                  Query parameter
                </Button>
              )
            }
          >
            <Stack spacing={1}>
              {rows.map((r) => (
                <SourceCard key={r.key} s={s} r={r} />
              ))}
            </Stack>
          </Section>
        </Stack>
        <Box
          sx={{
            bgcolor: 'action.hover',
            borderRadius: 2,
            p: 2,
            mt: 1,
            alignSelf: 'start',
            position: 'sticky',
            top: 0,
          }}
        >
          <Stack spacing={2.5}>
            <Section title="In the New menu">
              <Breadcrumbs separator={<ChevronRightIcon fontSize="small" />}>
                <Typography color="text.secondary">New</Typography>
                {path.map((p) => (
                  <Typography key={p} color="text.secondary">
                    {p}
                  </Typography>
                ))}
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <Typography sx={{ fontWeight: 600 }}>{s.form.name || 'Untitled'}</Typography>
                  {s.form.visibility === 'private' && (
                    <LockOutlinedIcon sx={{ fontSize: 14 }} color="action" />
                  )}
                </Stack>
              </Breadcrumbs>
            </Section>
            <Section title="Tab title">
              <Paper
                variant="outlined"
                sx={{
                  px: 1.5,
                  py: 1,
                  borderBottom: 3,
                  borderBottomColor: 'primary.main',
                  mb: 1.25,
                }}
              >
                <Typography noWrap>
                  {titleParts(s, rows).map((p, i) => (
                    <Box
                      key={i}
                      component="span"
                      sx={
                        p.placeholder ? { color: 'primary.main', fontStyle: 'italic' } : undefined
                      }
                    >
                      {i > 0 && ' '}
                      {p.placeholder ? `‹${p.text}›` : p.text}
                    </Box>
                  ))}
                </Typography>
              </Paper>
              <Typography variant="caption" color="text.secondary">
                Click to show or hide in the title
              </Typography>
              <Stack
                direction="row"
                spacing={0.75}
                sx={{ flexWrap: 'wrap', rowGap: 0.75, mt: 0.5 }}
              >
                {rows.map((r) => (
                  <Chip
                    key={r.key}
                    size="small"
                    label={r.label}
                    icon={r.showInTitle ? <TitleIcon /> : undefined}
                    color={r.showInTitle ? 'primary' : 'default'}
                    variant={r.showInTitle ? 'filled' : 'outlined'}
                    onClick={() => r.setShowInTitle(!r.showInTitle)}
                  />
                ))}
              </Stack>
            </Section>
            {query !== undefined && (
              <Section title="Query">
                <QueryCode declare={s.declareStatement} query={query} />
              </Section>
            )}
            {kept.length > 0 && (
              <Section title="Saved as they are">
                <Box
                  component="dl"
                  sx={{
                    m: 0,
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    columnGap: 2,
                    rowGap: 0.5,
                  }}
                >
                  {kept.map((k) => (
                    <Fragment key={k.title}>
                      <Typography component="dt" variant="body2" color="text.secondary">
                        {k.title}
                      </Typography>
                      <Typography
                        component="dd"
                        variant="body2"
                        sx={{ m: 0, fontFamily: 'monospace' }}
                      >
                        {k.text}
                      </Typography>
                    </Fragment>
                  ))}
                </Box>
              </Section>
            )}
          </Stack>
        </Box>
      </DialogContent>
      <Actions s={s} />
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// D: Compact list. Narrow dialog, one-line rows that expand to edit. Folder as a breadcrumb
// picker. Preview in tabs.

function FolderBreadcrumbs({ s }: { s: State }) {
  const path = folderPath(s.form.folder);
  const [open, setOpen] = useState<{ el: HTMLElement; level: number } | null>(null);
  const [typed, setTyped] = useState('');
  const set = (p: string[]) => s.setForm((f) => ({ ...f, folder: folderText(p) }));
  const pick = (name: string) => {
    if (!open) return;
    set([...path.slice(0, open.level), name]);
    setOpen(null);
    setTyped('');
  };
  const options = open ? childrenAt(s.folders, path.slice(0, open.level)) : [];
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        Folder in the New menu
      </Typography>
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          px: 1,
          minHeight: 44,
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ px: 0.5 }}>
          New
        </Typography>
        {path.map((seg, i) => (
          <Fragment key={i}>
            <ChevronRightIcon fontSize="small" sx={{ color: 'text.disabled' }} />
            <Button
              size="small"
              color="inherit"
              endIcon={<ArrowDropDownIcon />}
              onClick={(e) => setOpen({ el: e.currentTarget, level: i })}
              sx={{ textTransform: 'none', px: 1 }}
            >
              {seg}
            </Button>
          </Fragment>
        ))}
        <ChevronRightIcon fontSize="small" sx={{ color: 'text.disabled' }} />
        <Tooltip title="Put it in a subfolder">
          <IconButton
            size="small"
            onClick={(e) => setOpen({ el: e.currentTarget, level: path.length })}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Popover
        open={open !== null}
        anchorEl={open?.el}
        onClose={() => setOpen(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ width: 240 }}>
          <List dense disablePadding>
            {options.map((o) => (
              <ListItemButton
                key={o}
                selected={open !== null && path[open.level] === o}
                onClick={() => pick(o)}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <FolderOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={o} />
              </ListItemButton>
            ))}
            {open !== null && open.level < path.length && (
              <ListItemButton
                onClick={() => {
                  set(path.slice(0, open.level));
                  setOpen(null);
                }}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <CloseIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={
                    open.level === 0 ? 'Top level, no folder' : `Stop at ${path[open.level - 1]}`
                  }
                />
              </ListItemButton>
            )}
          </List>
          <Divider />
          <TextField
            size="small"
            fullWidth
            autoFocus
            placeholder="New folder"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && typed.trim() !== '' && pick(typed.trim())}
            sx={{ p: 1 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <CreateNewFolderOutlinedIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>
      </Popover>
    </Box>
  );
}

function CompactRow({
  s,
  r,
  open,
  onToggle,
}: {
  s: State;
  r: InputRow;
  open: boolean;
  onToggle: () => void;
}) {
  const qp = r.qpIndex;
  const errors = qp === undefined ? {} : queryParameterErrors(s.form, qp);
  const bad = errors.name !== undefined || errors.value !== undefined;
  const summary = r.fixed
    ? r.fixedText
    : r.columns.length > 0
      ? `row's ${r.columns.join(' or ')}`
      : 'asked for when opened';
  return (
    <Box sx={{ borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          height: 48,
          px: 1.5,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
        }}
        onClick={onToggle}
      >
        <Box
          sx={{
            width: 130,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'baseline',
            gap: 0.75,
            minWidth: 0,
          }}
        >
          {qp !== undefined && (
            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
              {positionLabel(qp, s.bound)}
            </Typography>
          )}
          <Typography noWrap sx={{ fontWeight: 500, color: bad ? 'error.main' : undefined }}>
            {r.label}
          </Typography>
        </Box>
        {r.fixed ? (
          <PushPinOutlinedIcon sx={{ fontSize: 16 }} color="action" />
        ) : (
          <TableRowsOutlinedIcon sx={{ fontSize: 16 }} color="primary" />
        )}
        <Typography
          variant="body2"
          noWrap
          sx={{
            flex: 1,
            fontFamily: r.fixed ? 'monospace' : undefined,
            color: r.fixed && r.unset ? 'text.disabled' : r.fixed ? 'text.primary' : 'primary.main',
          }}
        >
          {summary}
        </Typography>
        <Tooltip title={r.showInTitle ? 'Shown in the tab title' : 'Not in the tab title'}>
          <IconButton
            size="small"
            aria-pressed={r.showInTitle}
            aria-label={`Show ${r.label} in title`}
            onClick={(e) => {
              e.stopPropagation();
              r.setShowInTitle(!r.showInTitle);
            }}
            sx={{
              color: r.showInTitle ? 'primary.main' : 'text.disabled',
              bgcolor: r.showInTitle ? 'action.selected' : undefined,
            }}
          >
            <TitleIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <ExpandMoreIcon
          fontSize="small"
          sx={{
            transform: open ? 'rotate(180deg)' : undefined,
            transition: 'transform 150ms',
            color: 'action.active',
          }}
        />
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={1.5} sx={{ px: 2, pb: 2, pt: 0.5, bgcolor: 'action.hover' }}>
          {qp !== undefined && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', pt: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <QueryParameterName s={s} index={qp} />
              </Box>
              <Box sx={{ flexShrink: 0 }}>
                <QueryParameterType s={s} index={qp} width={130} />
              </Box>
              <MoveRemove s={s} index={qp} />
            </Stack>
          )}
          <RadioGroup
            value={r.fixed ? 'fixed' : 'row'}
            onChange={(e) => r.setFixed(e.target.value === 'fixed')}
          >
            <FormControlLabel
              value="fixed"
              control={<Radio size="small" />}
              label={<Typography variant="body2">Always the same value</Typography>}
            />
            {r.fixed && (
              <Box sx={{ pl: 4, pb: 1 }}>
                {qp !== undefined ? (
                  <>
                    <QueryParameterValue s={s} index={qp} />
                    {errors.value && (
                      <Typography variant="caption" color="error">
                        {errors.value}
                      </Typography>
                    )}
                  </>
                ) : (
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {r.fixedText}
                  </Typography>
                )}
              </Box>
            )}
            <FormControlLabel
              value="row"
              control={<Radio size="small" />}
              label={<Typography variant="body2">Read from the row you right-click</Typography>}
            />
            {!r.fixed && (
              <Box sx={{ pl: 4, display: 'flex' }}>
                <ColumnsField row={r} />
              </Box>
            )}
          </RadioGroup>
          {errors.name && (
            <Typography variant="caption" color="error">
              {errors.name}
            </Typography>
          )}
        </Stack>
      </Collapse>
    </Box>
  );
}

function VariantD({ s }: { s: State }) {
  const rows = inputRows(s);
  const query = queryText(s);
  const kept = keptParams(s);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState(query !== undefined ? 'query' : 'title');
  return (
    <Dialog open onClose={s.onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
        <Box sx={{ flex: 1 }}>Save preset</Box>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={s.form.visibility}
          onChange={(_, v: Preset['visibility'] | null) =>
            v && s.setForm((f) => ({ ...f, visibility: v }))
          }
        >
          <ToggleButton value="private" sx={{ gap: 0.5, px: 1.25, textTransform: 'none' }}>
            <LockOutlinedIcon sx={{ fontSize: 16 }} /> Private
          </ToggleButton>
          <ToggleButton value="shared" sx={{ gap: 0.5, px: 1.25, textTransform: 'none' }}>
            <GroupsOutlinedIcon sx={{ fontSize: 16 }} /> Shared
          </ToggleButton>
        </ToggleButtonGroup>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Name"
            value={s.form.name}
            onChange={(e) => s.setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <FolderBreadcrumbs s={s} />
          <Section
            title="Inputs"
            action={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ alignItems: 'center', color: 'text.secondary' }}
                >
                  <PushPinOutlinedIcon sx={{ fontSize: 14 }} />
                  <Typography variant="caption">fixed</Typography>
                  <TableRowsOutlinedIcon sx={{ fontSize: 14, ml: 1 }} />
                  <Typography variant="caption">from row</Typography>
                  <TitleIcon sx={{ fontSize: 14, ml: 1 }} />
                  <Typography variant="caption">in title</Typography>
                </Stack>
                {takesQueryParameters(s.action) && (
                  <IconButton
                    size="small"
                    aria-label="Add query parameter"
                    onClick={() => {
                      s.addQueryParameter();
                      setOpen(`qp-${s.form.queryParameters.length}`);
                    }}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            }
          >
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              {rows.map((r) => (
                <CompactRow
                  key={r.key}
                  s={s}
                  r={r}
                  open={open === r.key}
                  onToggle={() => setOpen((o) => (o === r.key ? null : r.key))}
                />
              ))}
            </Box>
            {kept.length > 0 && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 0.75 }}
              >
                Saved as they are: {kept.map((k) => `${k.title} ${k.text}`).join(' · ')}
              </Typography>
            )}
          </Section>
          <Paper variant="outlined">
            <Tabs
              value={tab}
              onChange={(_, v: string) => setTab(v)}
              sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider' }}
            >
              {query !== undefined && (
                <Tab value="query" label="Query" sx={{ minHeight: 36, py: 0 }} />
              )}
              <Tab value="title" label="Tab title" sx={{ minHeight: 36, py: 0 }} />
            </Tabs>
            <Box sx={{ p: 1.5 }}>
              {tab === 'query' && query !== undefined ? (
                <QueryCode declare={s.declareStatement} query={query} />
              ) : (
                <Typography>
                  {titleParts(s, rows).map((p, i) => (
                    <Box
                      key={i}
                      component="span"
                      sx={
                        p.placeholder ? { color: 'primary.main', fontStyle: 'italic' } : undefined
                      }
                    >
                      {i > 0 && ' '}
                      {p.placeholder ? `‹${p.text}›` : p.text}
                    </Box>
                  ))}
                </Typography>
              )}
            </Box>
          </Paper>
        </Stack>
      </DialogContent>
      <Actions s={s} />
    </Dialog>
  );
}

/** Variants B to F, sharing one form state. */
export function SavePresetDialogVariant({ variant, ...props }: DialogProps & { variant: string }) {
  const s = useDialogState(props);
  if (variant === 'B') return <VariantB s={s} />;
  if (variant === 'E') return <VariantB s={s} title="template" />;
  if (variant === 'F') return <VariantB s={s} title="tokens" />;
  if (variant === 'C') return <VariantC s={s} />;
  return <VariantD s={s} />;
}
