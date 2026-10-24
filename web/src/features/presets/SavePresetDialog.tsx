import DeleteIcon from '@mui/icons-material/Delete';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { CatalogueAction, Preset, PresetFields } from '../../lib/api';
import {
  QUERY_PARAMETER_TYPES,
  takesQueryParameters,
  type QueryParameterType,
} from '../action-tab/queryParameters';
import {
  canSave,
  formFields,
  initialForm,
  previewLines,
  queryParameterErrors,
  rowParams,
  suggestedNames,
  valueOrType,
  type InputMode,
  type PresetForm,
  type QueryParameterForm,
} from './presetForm';
import { usePresetsStore, type PresetsStore } from './presetsStore';

export interface SavePresetDialogProps {
  action: CatalogueAction;
  /** The values to save: the tab's params, or the preset's when editing it. */
  params: Record<string, unknown>;
  /** The preset being edited or saved again, if any. */
  source?: Preset;
  onClose: () => void;
  /** After a save, with the preset as saved. */
  onSaved?: (preset: Preset) => void;
  store?: PresetsStore;
}

/**
 * One query parameter the dialog declares: its name, picked from the names in the query or typed,
 * its type, and a fixed value or the columns of the clicked row to read.
 */
function QueryParameterFields({
  index,
  form,
  suggestions,
  onChange,
  onRemove,
}: {
  index: number;
  form: PresetForm;
  suggestions: readonly string[];
  onChange: (changes: Partial<QueryParameterForm>) => void;
  onRemove: () => void;
}) {
  const qp = form.queryParameters[index]!;
  const errors = queryParameterErrors(form, index);
  return (
    <Stack
      role="group"
      aria-label={`Query parameter ${index + 1}`}
      direction="row"
      spacing={1}
      sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 1 }}
    >
      <Autocomplete
        freeSolo
        openOnFocus
        options={suggestions}
        inputValue={qp.name}
        onInputChange={(_, name) => onChange({ name })}
        sx={{ width: 180 }}
        renderInput={(input) => (
          <TextField
            {...input}
            size="small"
            label="Name"
            error={errors.name !== undefined}
            helperText={errors.name}
          />
        )}
      />
      <TextField
        select
        size="small"
        label="Type"
        value={qp.type}
        onChange={(e) => onChange({ type: e.target.value as QueryParameterType })}
        slotProps={{ select: { native: true } }}
        sx={{ width: 120 }}
      >
        {QUERY_PARAMETER_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </TextField>
      <ToggleButtonGroup
        size="small"
        exclusive
        aria-label="Value"
        value={qp.fixed ? 'fixed' : 'row'}
        onChange={(_, value: string | null) => value && onChange({ fixed: value === 'fixed' })}
      >
        <ToggleButton value="fixed">Fixed</ToggleButton>
        <ToggleButton value="row">From row</ToggleButton>
      </ToggleButtonGroup>
      {qp.fixed ? (
        <TextField
          size="small"
          label="Value"
          value={qp.value}
          onChange={(e) => onChange({ value: e.target.value })}
          error={errors.value !== undefined}
          helperText={errors.value}
          sx={{ flex: 1, minWidth: 160 }}
        />
      ) : (
        <TextField
          size="small"
          label="Columns"
          value={qp.columns}
          onChange={(e) => onChange({ columns: e.target.value })}
          helperText="Of the clicked row, separated by commas; none asks when opened"
          sx={{ flex: 1, minWidth: 160 }}
        />
      )}
      <Tooltip title="Remove">
        <IconButton aria-label="Remove" size="small" onClick={onRemove}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

/**
 * Saves params of an action as a preset: its name, folder and who sees it, and for each param rows
 * can fill whether its value is fixed or read from columns of the clicked row. For an action that
 * takes query parameters, it declares them too. Your own preset is updated or saved as new; anyone
 * else's is saved as your own copy. Mount it to open it.
 */
export function SavePresetDialog({
  action,
  params,
  source,
  onClose,
  onSaved,
  store = usePresetsStore,
}: SavePresetDialogProps) {
  const [form, setForm] = useState(() => initialForm(action, params, source));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owned = source !== undefined && source.owned;
  const setMode = (name: string, mode: InputMode) =>
    setForm((f) => ({ ...f, modes: { ...f.modes, [name]: mode } }));
  const setQueryParameters = (change: (all: QueryParameterForm[]) => QueryParameterForm[]) =>
    setForm((f) => ({ ...f, queryParameters: change(f.queryParameters) }));
  const suggestions = suggestedNames(action, params, form);

  const save = async (write: (fields: PresetFields) => Promise<Preset>) => {
    setSaving(true);
    setError(null);
    try {
      const preset = await write(formFields(action, params, form));
      onSaved?.(preset);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };
  const create = () => save((fields) => store.getState().create(fields));
  const unsavable = !canSave(form);

  return (
    <Dialog open onClose={onClose} aria-labelledby="save-preset-title" fullWidth maxWidth="sm">
      <DialogTitle id="save-preset-title">Save preset</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <TextField
            label="Menu folder"
            helperText="Folders separated by /"
            value={form.folder}
            onChange={(e) => setForm((f) => ({ ...f, folder: e.target.value }))}
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
          {rowParams(action).map((p) => {
            const mode = form.modes[p.name] ?? { fixed: true, columns: [] };
            return (
              <Stack key={p.name} spacing={0.5}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography sx={{ minWidth: 120 }}>{p.title}</Typography>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    aria-label={p.title}
                    value={mode.fixed ? 'fixed' : 'row'}
                    onChange={(_, value: string | null) =>
                      value &&
                      setMode(p.name, {
                        fixed: value === 'fixed',
                        columns: mode.columns.length > 0 ? mode.columns : (p.fromColumns ?? []),
                      })
                    }
                  >
                    <ToggleButton value="fixed" aria-label={`${p.title} fixed`}>
                      Fixed
                    </ToggleButton>
                    <ToggleButton value="row" aria-label={`${p.title} from the row`}>
                      From row
                    </ToggleButton>
                  </ToggleButtonGroup>
                  {mode.fixed && (
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {valueOrType(p, params[p.name])}
                    </Typography>
                  )}
                </Stack>
                {!mode.fixed && (
                  <Stack direction="row" sx={{ flexWrap: 'wrap', pl: 2 }}>
                    {(p.fromColumns ?? []).map((column) => (
                      <FormControlLabel
                        key={column}
                        label={column}
                        control={
                          <Checkbox
                            size="small"
                            checked={mode.columns.includes(column)}
                            onChange={(e) =>
                              setMode(p.name, {
                                fixed: false,
                                columns: (p.fromColumns ?? []).filter((c) =>
                                  c === column ? e.target.checked : mode.columns.includes(c),
                                ),
                              })
                            }
                          />
                        }
                      />
                    ))}
                  </Stack>
                )}
              </Stack>
            );
          })}
          {takesQueryParameters(action) && (
            <Stack spacing={1.5}>
              <Typography variant="subtitle2">Query parameters</Typography>
              {form.queryParameters.map((_, i) => (
                <QueryParameterFields
                  key={i}
                  index={i}
                  form={form}
                  suggestions={suggestions}
                  onChange={(changes) =>
                    setQueryParameters((all) =>
                      all.map((qp, j) => (j === i ? { ...qp, ...changes } : qp)),
                    )
                  }
                  onRemove={() => setQueryParameters((all) => all.filter((_, j) => j !== i))}
                />
              ))}
              <div>
                <Button
                  size="small"
                  onClick={() =>
                    setQueryParameters((all) => [
                      ...all,
                      { name: '', type: 'string', fixed: true, value: '', columns: '' },
                    ])
                  }
                >
                  Add query parameter
                </Button>
              </div>
            </Stack>
          )}
          <div>
            <Typography variant="subtitle2" id="save-preset-preview">
              Preview
            </Typography>
            <Box
              component="ul"
              aria-labelledby="save-preset-preview"
              sx={{ listStyle: 'none', m: 0, p: 0 }}
            >
              {previewLines(action, params, form).map((line, i) => (
                <Typography
                  component="li"
                  key={i}
                  variant="body2"
                  sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
                >
                  {line}
                </Typography>
              ))}
            </Box>
          </div>
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
