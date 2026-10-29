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
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { ColumnView, ColumnViewFields } from '../../lib/api';

export interface SaveViewDialogProps {
  /** The column view the tab started from or last picked, when it's a saved one. */
  source?: ColumnView;
  /** Writes the name and sharing, as a new column view or over `source`. */
  onSave: (
    fields: Omit<ColumnViewFields, 'state'>,
    over: ColumnView | null,
    start?: boolean,
  ) => Promise<void>;
  /** PROTOTYPE: when set, a checkbox with this label makes the saved view the start view. */
  startLabel?: string;
  /** PROTOTYPE: one button, and the name decides: unchanged updates your own view, changed saves new. */
  nameDecides?: boolean;
  onClose: () => void;
}

/**
 * Saves the tab's columns and filters as a column view: its name and who sees it. Your own column view is
 * updated or saved as new; anyone else's is saved as your own. Mount it to open it.
 */
export function SaveColumnViewDialog({
  source,
  onSave,
  onClose,
  startLabel,
  nameDecides,
}: SaveViewDialogProps) {
  const [name, setName] = useState(source?.name ?? '');
  const [visibility, setVisibility] = useState<ColumnView['visibility']>(
    source?.owned ? source.visibility : 'private',
  );
  const [saving, setSaving] = useState(false);
  const [start, setStart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blank = name.trim() === '';
  /** With `nameDecides`: whether saving updates `source` (your own, name unchanged). */
  const updating = !!source?.owned && name.trim() === source.name;

  const save = async (over: ColumnView | null) => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), visibility }, over, start);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} aria-labelledby="save-view-title" fullWidth maxWidth="xs">
      <DialogTitle id="save-view-title">Save column view</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            helperText={
              nameDecides && source?.owned
                ? updating
                  ? 'Change the name to save a new view instead.'
                  : `Saves a new view. "${source.name}" stays as it is.`
                : undefined
            }
          />
          <FormControlLabel
            label="Share with everyone"
            control={
              <Switch
                checked={visibility === 'shared'}
                onChange={(e) => setVisibility(e.target.checked ? 'shared' : 'private')}
              />
            }
          />
          {startLabel && (
            <FormControlLabel
              label={startLabel}
              control={<Checkbox checked={start} onChange={(e) => setStart(e.target.checked)} />}
            />
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
        {nameDecides ? (
          <Button
            variant="contained"
            disabled={saving || blank}
            onClick={() => void save(updating ? source : null)}
          >
            {updating ? `Update "${source.name}"` : 'Save new view'}
          </Button>
        ) : source?.owned ? (
          <>
            <Button disabled={saving || blank} onClick={() => void save(null)}>
              Save as new
            </Button>
            <Button
              variant="contained"
              disabled={saving || blank}
              onClick={() => void save(source)}
            >
              Update "{source.name}"
            </Button>
          </>
        ) : (
          <Button variant="contained" disabled={saving || blank} onClick={() => void save(null)}>
            Save
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
