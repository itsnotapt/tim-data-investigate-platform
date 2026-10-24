import Button from '@mui/material/Button';
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
  onSave: (fields: Omit<ColumnViewFields, 'state'>, over: ColumnView | null) => Promise<void>;
  onClose: () => void;
}

/**
 * Saves the tab's columns and filters as a column view: its name and who sees it. Your own column view is
 * updated or saved as new; anyone else's is saved as your own. Mount it to open it.
 */
export function SaveColumnViewDialog({ source, onSave, onClose }: SaveViewDialogProps) {
  const [name, setName] = useState(source?.name ?? '');
  const [visibility, setVisibility] = useState<ColumnView['visibility']>(
    source?.owned ? source.visibility : 'private',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blank = name.trim() === '';

  const save = async (over: ColumnView | null) => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), visibility }, over);
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
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <FormControlLabel
            label="Share with everyone"
            control={
              <Switch
                checked={visibility === 'shared'}
                onChange={(e) => setVisibility(e.target.checked ? 'shared' : 'private')}
              />
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
        {source?.owned ? (
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
