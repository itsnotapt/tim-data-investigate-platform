import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useId, useState, type ReactNode } from 'react';
import type { CatalogueAction, Preset, PresetFields } from '../../lib/api';
import { useDeclareStatement } from '../action-tab/declareStatement';
import {
  bindsByPosition,
  positionLabel,
  queryParameterTypes,
  takesQueryParameters,
  type QueryParameterType,
} from '../action-tab/queryParameters';
import { useInstanceStore } from '../instance';
import { FolderField } from './FolderField';
import { InputsTable, type InputRow } from './InputsTable';
import {
  canSave,
  formFields,
  formTitle,
  initialForm,
  keptParams,
  queryParameterErrors,
  queryText,
  rowParams,
  suggestedNames,
  titleError,
  valueOrType,
  type InputMode,
  type PresetForm,
  type QueryParameterForm,
} from './presetForm';
import { usePresetsStore, type PresetsStore } from './presetsStore';
import { QueryBlock } from './QueryBlock';

export interface SavePresetDialogProps {
  action: CatalogueAction;
  /** The values to save: the tab's params, or the preset's when editing it. */
  params: Record<string, unknown>;
  /** The preset being edited or saved again, if any. */
  source?: Preset;
  /** The Id column to save: the tab's, or the preset's when editing it, when it isn't the action's. */
  idColumn?: string | null;
  onClose: () => void;
  /** After a save, with the preset as saved. */
  onSaved?: (preset: Preset) => void;
  store?: PresetsStore;
}

const NO_ACTIONS: readonly CatalogueAction[] = [];

/** The id of the line under the inputs table that says what's wrong with a query parameter field. */
type ErrorId = (index: number, field: 'name' | 'value') => string;

/** A query parameter's controls: move it up or down, or remove it. */
function QueryParameterControls({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  /** Swaps it with the one before (`-1`) or after (`1`). */
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const control = (label: string, icon: ReactNode, onClick: () => void, disabled = false) => (
    <Tooltip title={label}>
      <span>
        <IconButton aria-label={label} size="small" disabled={disabled} onClick={onClick}>
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
  return (
    <Stack direction="row" sx={{ flexShrink: 0 }}>
      {control('Move up', <ArrowUpwardIcon fontSize="small" />, () => onMove(-1), index === 0)}
      {control(
        'Move down',
        <ArrowDownwardIcon fontSize="small" />,
        () => onMove(1),
        index === count - 1,
      )}
      {control('Remove', <DeleteOutlineIcon fontSize="small" />, onRemove)}
    </Stack>
  );
}

/**
 * The rows of the inputs table: each param of the action rows can fill, then each query
 * parameter, with fields for its name, type and fixed value and controls to move or remove it.
 */
function inputRows({
  action,
  params,
  form,
  setForm,
  bound,
  types,
  suggestions,
  errorId,
}: {
  action: CatalogueAction;
  params: Record<string, unknown>;
  form: PresetForm;
  setForm: (change: (form: PresetForm) => PresetForm) => void;
  bound: boolean;
  types: readonly QueryParameterType[];
  suggestions: readonly string[];
  errorId: ErrorId;
}): InputRow[] {
  const setMode = (name: string, mode: InputMode) =>
    setForm((f) => ({ ...f, modes: { ...f.modes, [name]: mode } }));
  const setQueryParameters = (change: (all: QueryParameterForm[]) => QueryParameterForm[]) =>
    setForm((f) => ({ ...f, queryParameters: change(f.queryParameters) }));
  const change = (index: number, changes: Partial<QueryParameterForm>) =>
    setQueryParameters((all) => all.map((qp, j) => (j === index ? { ...qp, ...changes } : qp)));
  const move = (from: number, to: number) =>
    setQueryParameters((all) => {
      const moved = [...all];
      [moved[from], moved[to]] = [moved[to]!, moved[from]!];
      return moved;
    });

  const fromParams = rowParams(action).map((p): InputRow => {
    const mode = form.modes[p.name] ?? { fixed: true, columns: [] };
    const fromColumns = p.fromColumns ?? [];
    const value = valueOrType(p, params[p.name]);
    return {
      key: `param:${p.name}`,
      label: p.name,
      input: <Typography noWrap>{p.name}</Typography>,
      type: (
        <Typography variant="body2" color="text.secondary" noWrap>
          {p.many ? `${p.kind} list` : p.kind}
        </Typography>
      ),
      fixed: mode.fixed,
      setFixed: (fixed) =>
        setMode(p.name, { fixed, columns: mode.columns.length > 0 ? mode.columns : fromColumns }),
      value: (
        <Typography noWrap variant="body2" title={value} sx={{ flex: 1, fontFamily: 'monospace' }}>
          {value}
        </Typography>
      ),
      columns: mode.columns,
      columnOptions: fromColumns,
      setColumns: (columns) =>
        setMode(p.name, { ...mode, columns: fromColumns.filter((c) => columns.includes(c)) }),
    };
  });

  const queryParameterRows = form.queryParameters.map((qp, i): InputRow => {
    const errors = queryParameterErrors(form, i);
    return {
      key: `queryParameter:${i}`,
      label: `Query parameter ${i + 1}`,
      input: (
        <Autocomplete
          freeSolo
          openOnFocus
          size="small"
          options={suggestions}
          inputValue={qp.name}
          onInputChange={(_, name) => change(i, { name })}
          sx={{ width: '100%' }}
          renderInput={(input) => (
            <TextField
              {...input}
              placeholder="name"
              error={errors.name !== undefined}
              slotProps={{
                ...input.slotProps,
                htmlInput: {
                  ...input.slotProps.htmlInput,
                  'aria-label': 'Name',
                  'aria-describedby': errors.name && errorId(i, 'name'),
                },
                input: {
                  ...input.slotProps.input,
                  startAdornment: bound && (
                    <InputAdornment position="start" sx={{ fontFamily: 'monospace', mr: 0.5 }}>
                      {positionLabel(i, bound)}
                    </InputAdornment>
                  ),
                },
              }}
            />
          )}
        />
      ),
      type: (
        <TextField
          select
          size="small"
          fullWidth
          value={qp.type}
          onChange={(e) => change(i, { type: e.target.value as QueryParameterType })}
          slotProps={{ select: { native: true }, htmlInput: { 'aria-label': 'Type' } }}
        >
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </TextField>
      ),
      fixed: qp.fixed,
      setFixed: (fixed) => change(i, { fixed }),
      value: (
        <TextField
          size="small"
          placeholder={`<${qp.type}>`}
          value={qp.value}
          onChange={(e) => change(i, { value: e.target.value })}
          error={errors.value !== undefined}
          slotProps={{
            htmlInput: {
              'aria-label': 'Value',
              'aria-describedby': errors.value && errorId(i, 'value'),
            },
          }}
          sx={{ flex: 1, minWidth: 0 }}
        />
      ),
      columns: qp.columns,
      columnOptions: [],
      setColumns: (columns) => change(i, { columns }),
      controls: (
        <QueryParameterControls
          index={i}
          count={form.queryParameters.length}
          onMove={(by) => move(i, i + by)}
          onRemove={() => setQueryParameters((all) => all.filter((_, j) => j !== i))}
        />
      ),
    };
  });

  return [...fromParams, ...queryParameterRows];
}

/**
 * Saves params of an action as a preset: its name, its folder in the New menu and who sees it,
 * its inputs as a table, and the title template of its tabs. Each input that rows can fill is
 * Fixed or read From row; an action that takes query parameters declares them as inputs too, and
 * shows its query with the declare statement they add. Your own preset is updated or saved as
 * new; anyone else's is saved as your own copy. Mount it to open it.
 */
export function SavePresetDialog({
  action,
  params,
  source,
  idColumn = null,
  onClose,
  onSaved,
  store = usePresetsStore,
}: SavePresetDialogProps) {
  const [form, setForm] = useState(() => initialForm(action, params, source));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  const errorId: ErrorId = (index, field) => `${ids}-${index}-${field}`;
  const owned = source !== undefined && source.owned;
  const actions = useInstanceStore((s) => s.instance?.actions ?? NO_ACTIONS);
  const presets = store((s) => s.presets);
  const declareStatement = useDeclareStatement(action.key, form.queryParameters);
  const query = queryText(action, params);
  const kept = keptParams(action, params);
  const rows = inputRows({
    action,
    params,
    form,
    setForm,
    bound: bindsByPosition(action.params),
    types: queryParameterTypes(action),
    suggestions: suggestedNames(action, params, form),
    errorId,
  });
  const queryParametersTaken = takesQueryParameters(action);

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
  const create = () => save((fields) => store.getState().create(fields));
  const unsavable = !canSave(action, form);
  const tabTitleError = titleError(action, form);

  return (
    <Dialog open onClose={onClose} aria-labelledby="save-preset-title" fullWidth maxWidth="md">
      <DialogTitle id="save-preset-title">Save preset</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <FolderField
            value={form.folder}
            folders={[...actions.map((a) => a.menuPath), ...presets.map((p) => p.menuPath ?? [])]}
            onChange={(folder) => setForm((f) => ({ ...f, folder }))}
          />
          <FormControlLabel
            label="Share with everyone"
            control={
              <Switch
                checked={form.visibility === 'shared'}
                onChange={(e) =>
                  setForm((f) => ({ ...f, visibility: e.target.checked ? 'shared' : 'private' }))
                }
              />
            }
          />
          {(rows.length > 0 || queryParametersTaken || kept.length > 0) && (
            <div>
              <Stack direction="row" sx={{ alignItems: 'center', mb: 0.75, minHeight: 30 }}>
                <Typography
                  variant="overline"
                  sx={{ color: 'text.secondary', lineHeight: 1, flex: 1 }}
                >
                  Inputs
                </Typography>
                {queryParametersTaken && (
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    aria-label="Add query parameter"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        queryParameters: [
                          ...f.queryParameters,
                          { name: '', type: 'string', fixed: true, value: '', columns: [] },
                        ],
                      }))
                    }
                  >
                    Query parameter
                  </Button>
                )}
              </Stack>
              {rows.length > 0 && <InputsTable rows={rows} />}
              {form.queryParameters.map((qp, i) => {
                const errors = queryParameterErrors(form, i);
                return (['name', 'value'] as const).map(
                  (field) =>
                    errors[field] && (
                      <Typography key={`${i}-${field}`} variant="body2" color="error">
                        {qp.name || `Query parameter ${i + 1}`}:{' '}
                        <span id={errorId(i, field)}>{errors[field]}</span>
                      </Typography>
                    ),
                );
              })}
              {kept.length > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Also saved: {kept.map((k) => `${k.name}: ${k.text}`).join(' · ')}
                </Typography>
              )}
            </div>
          )}
          <TextField
            label="Tab title"
            value={formTitle(action, form)}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            error={tabTitleError !== undefined}
            helperText={tabTitleError}
          />
          {query !== undefined && (
            <Box>
              <Typography
                variant="overline"
                component="div"
                sx={{ color: 'text.secondary', lineHeight: 1, mb: 0.75 }}
              >
                Query
              </Typography>
              <QueryBlock query={query} declareStatement={declareStatement} />
            </Box>
          )}
          {error && (
            <Typography color="error" role="alert">
              Couldn't save: {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {owned ? (
          <>
            <Button disabled={saving || unsavable} onClick={() => void create()}>
              Save as new
            </Button>
            <Button
              variant="contained"
              disabled={saving || unsavable}
              onClick={() =>
                void save((fields) => store.getState().replace(source.presetId, fields))
              }
            >
              Update "{source.name}"
            </Button>
          </>
        ) : (
          <Button variant="contained" disabled={saving || unsavable} onClick={() => void create()}>
            Save
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
