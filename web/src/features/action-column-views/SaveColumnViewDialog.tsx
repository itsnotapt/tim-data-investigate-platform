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
  /** The saved column view whose edits are being saved; left out to always save a new one. */
  source?: ColumnView;
  /** The name of the tab's preset or action, which the saved column view can be the default for. */
  scopeName: string;
  /** Writes the name and sharing, as a new column view or over `over`. */
  onSave: (
    fields: Omit<ColumnViewFields, 'state'>,
    over: ColumnView | null,
    makeDefault: boolean,
  ) => Promise<void>;
  onClose: () => void;
}

/**
 * Saves the tab's columns and filters as a column view: its name and who sees it. The name decides
 * what the one button does: your own `source` is updated while its name is unchanged, and any
 * other name saves a new column view. Anyone else's column view is always saved as a new one of
 * your own. Mount it to open it.
 */
export function SaveColumnViewDialog({ source, scopeName, onSave, onClose }: SaveViewDialogProps) {
  const [name, setName] = useState(source?.name ?? '');
  const [visibility, setVisibility] = useState<ColumnView['visibility']>(
    source?.owned ? source.visibility : 'private',
  );
  const [makeDefault, setMakeDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blank = name.trim() === '';
  const own = source?.owned ? source : undefined;
  const updating = own !== undefined && name.trim() === own.name;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), visibility }, updating ? own : null, makeDefault);
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
              own &&
              (updating
                ? 'Change the name to save a new view instead.'
                : `Saves a new view. "${own.name}" stays as it is.`)
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
          <FormControlLabel
            label={`Make it the default for "${scopeName}"`}
            control={
              <Checkbox checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
            }
          />
          {error && (
            <Typography color="error" role="alert">
              Couldn't save: {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={saving || blank} onClick={() => void save()}>
          {updating ? `Update "${own.name}"` : 'Save new view'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
