import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { CatalogueAction, Preset, PresetFields } from '../../lib/api';
import {
  formFields,
  initialForm,
  previewLines,
  rowParams,
  valueOrType,
  type InputMode,
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
 * Saves params of an action as a preset: its name, folder and who sees it, and for each param rows
 * can fill whether its value is fixed or read from columns of the clicked row. Your own preset is
 * updated or saved as new; anyone else's is saved as your own copy. Mount it to open it.
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
  const blank = form.name.trim() === '';

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
          <div>
            <Typography variant="subtitle2">Preview</Typography>
            {previewLines(action, params, form).map((line) => (
              <Typography key={line} variant="body2" sx={{ fontFamily: 'monospace' }}>
                {line}
              </Typography>
            ))}
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
            <Button disabled={saving || blank} onClick={() => void create()}>
              Save as new
            </Button>
            <Button
              variant="contained"
              disabled={saving || blank}
              onClick={() =>
                void save((fields) => store.getState().replace(source.presetId, fields))
              }
            >
              Update "{source.name}"
            </Button>
          </>
        ) : (
          <Button variant="contained" disabled={saving || blank} onClick={() => void create()}>
            Save
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
