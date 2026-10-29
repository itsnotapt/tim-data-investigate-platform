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

export interface RenameViewDialogProps {
  /** A column view the analyst owns. */
  view: ColumnView;
  /** Writes the name and sharing; the column view's columns stay as they are. */
  onSave: (fields: Omit<ColumnViewFields, 'state'>) => Promise<void>;
  onClose: () => void;
}

/** Renames your own column view and changes who sees it. Mount it to open it. */
export function RenameColumnViewDialog({ view, onSave, onClose }: RenameViewDialogProps) {
  const [name, setName] = useState(view.name);
  const [visibility, setVisibility] = useState(view.visibility);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), visibility });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} aria-labelledby="rename-view-title" fullWidth maxWidth="xs">
      <DialogTitle id="rename-view-title">Rename "{view.name}"</DialogTitle>
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
        <Button
          variant="contained"
          disabled={saving || name.trim() === ''}
          onClick={() => void save()}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
