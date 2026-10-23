import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';

export interface PresetsLoadErrorDialogProps {
  error: string;
  onRetry: () => void;
  onClose: () => void;
}

/**
 * Save… when the presets can't be loaded: without them it can't tell whether to update the tab's
 * preset, so it offers to retry instead of saving a copy.
 */
export function PresetsLoadErrorDialog({ error, onRetry, onClose }: PresetsLoadErrorDialogProps) {
  return (
    <Dialog open onClose={onClose} aria-labelledby="presets-load-error-title">
      <DialogTitle id="presets-load-error-title">Save preset</DialogTitle>
      <DialogContent>
        <Alert severity="error">Couldn't load your presets: {error}</Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={onRetry}>
          Retry
        </Button>
      </DialogActions>
    </Dialog>
  );
}
