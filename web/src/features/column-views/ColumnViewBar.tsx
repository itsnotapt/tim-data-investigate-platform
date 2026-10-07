import { useState } from 'react';
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AssignmentTurnedInOutlinedIcon from '@mui/icons-material/AssignmentTurnedInOutlined';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import type { ColumnState } from 'ag-grid-community';
import type { ColumnView } from '../../lib/storage';
import { useColumnViewsStore } from './columnViewsStore';

/** The part of the AG Grid api the bar needs. */
export interface ColumnStateApi {
  getColumnState(): ColumnState[];
  applyColumnState(params: { state: ColumnState[]; applyOrder?: boolean }): boolean;
}

export interface ColumnViewBarProps {
  /** Grid api once the grid is ready; all actions are disabled before. */
  api: ColumnStateApi | null;
}

interface Option {
  uuid: string;
  name: string;
  create?: boolean;
}

const CREATE_UUID = '__create__';
const filter = createFilterOptions<Option>();

/** Pick / create a view, apply, rename, delete and save it. */
export function ColumnViewBar({ api }: ColumnViewBarProps) {
  const views = useColumnViewsStore((s) => s.views);
  const actions = useColumnViewsStore.getState();

  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const [renameName, setRenameName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // A view removed elsewhere (or deleted here) no longer counts as selected.
  const selected: ColumnView | null = views.find((v) => v.uuid === selectedUuid) ?? null;

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onSelect = (option: Option | null) => {
    if (!option) {
      setSelectedUuid(null);
    } else if (option.create) {
      const name = option.name.trim();
      if (!api || !name) return;
      void run(async () => setSelectedUuid(await actions.add(name, api.getColumnState())));
    } else {
      setSelectedUuid(option.uuid);
    }
  };

  const apply = () => {
    if (!api || !selected) return;
    api.applyColumnState({ state: selected.columnState as ColumnState[], applyOrder: true });
  };

  const save = () => {
    if (!api || !selected) return;
    const uuid = selected.uuid;
    void run(() => actions.saveState(uuid, api.getColumnState()));
  };

  const openRename = () => {
    if (!selected) return;
    setRenameName(selected.name);
    setDialog('rename');
  };

  const confirmRename = () => {
    if (!selected || !renameName.trim()) return;
    const uuid = selected.uuid;
    void run(async () => {
      await actions.rename(uuid, renameName);
      setDialog(null);
    });
  };

  const confirmDelete = () => {
    if (!selected) return;
    const uuid = selected.uuid;
    void run(async () => {
      await actions.remove(uuid);
      setSelectedUuid(null);
      setDialog(null);
    });
  };

  const noSelection = !selected || !api;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Autocomplete<Option, false, false, false>
        size="small"
        sx={{ flex: 1, minWidth: 160 }}
        options={views}
        value={selected}
        inputValue={input}
        onInputChange={(_, value, reason) => {
          // `reset` fires after a selection; typing and clearing come through as `input` / `clear`.
          setInput(value);
          if (reason === 'clear') setSelectedUuid(null);
        }}
        onChange={(_, option) => onSelect(option)}
        getOptionLabel={(o) => o.name}
        getOptionKey={(o) => o.uuid}
        isOptionEqualToValue={(a, b) => a.uuid === b.uuid}
        getOptionDisabled={(o) => o.create === true && !o.name.trim()}
        filterOptions={(options, params) => {
          const filtered = filter(options, params);
          // Prepended item: shows the typed text, or a hint while the field is empty.
          // While the field just echoes the selected view, nothing new is being typed.
          const typed = selected && params.inputValue === selected.name ? '' : params.inputValue;
          return [{ uuid: CREATE_UUID, name: typed, create: true }, ...filtered];
        }}
        renderOption={({ key, ...props }, option) => (
          <li key={key} {...props}>
            {option.create ? (
              <Box>
                <Typography variant="body2">
                  {option.name.trim() || 'Type to add new column view...'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Create column view
                </Typography>
              </Box>
            ) : (
              option.name
            )}
          </li>
        )}
        renderInput={(params) => <TextField {...params} label="Column view" />}
      />
      <IconButton
        size="small"
        title="Apply column view"
        aria-label="Apply column view"
        disabled={noSelection}
        onClick={apply}
      >
        <AssignmentTurnedInOutlinedIcon fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        title="Rename column view"
        aria-label="Rename column view"
        disabled={noSelection}
        onClick={openRename}
      >
        <EditIcon fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        title="Delete column view"
        aria-label="Delete column view"
        disabled={noSelection}
        onClick={() => setDialog('delete')}
      >
        <DeleteIcon fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        title="Save this column view"
        aria-label="Save this column view"
        disabled={noSelection}
        onClick={save}
      >
        <SaveIcon fontSize="small" />
      </IconButton>
      {error && (
        <Typography variant="caption" color="error" role="alert">
          {error}
        </Typography>
      )}

      <Dialog open={dialog === 'rename'} onClose={() => setDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>Rename column view</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            variant="standard"
            label="Rename column view"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>Close</Button>
          <Button onClick={confirmRename} disabled={!renameName.trim()}>
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === 'delete'} onClose={() => setDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>Delete column view</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you wish to delete &quot;{selected?.name}&quot;?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>Close</Button>
          <Button onClick={confirmDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
