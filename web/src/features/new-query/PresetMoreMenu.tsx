import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useState } from 'react';
import type { Preset } from '../../lib/api';

export interface PresetMoreMenuProps {
  preset: Preset;
  /** Whether the signed-in analyst owns the preset. */
  owned: boolean;
  /** `false` when the preset's action is not in the catalogue. */
  canOpen: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onVisibility: (visibility: Preset['visibility']) => void;
  onDelete: () => void;
  onHidden: (hidden: boolean) => void;
  /** Only for a preset of an action whose presets are action files. */
  onCopyActionFile?: () => void;
}

/**
 * A preset's ⋯ menu. The owner edits, shares or makes private and deletes it; anyone else hides
 * or unhides it for themselves. Anyone opens or duplicates it, and copies it as an action file
 * when its action has them.
 */
export function PresetMoreMenu({
  preset,
  owned,
  canOpen,
  onOpen,
  onEdit,
  onDuplicate,
  onVisibility,
  onDelete,
  onHidden,
  onCopyActionFile,
}: PresetMoreMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const close = () => setAnchor(null);
  const item = (label: string, run: () => void, disabled = false) => (
    <MenuItem
      key={label}
      disabled={disabled}
      onClick={() => {
        close();
        run();
      }}
    >
      {label}
    </MenuItem>
  );
  const shared = preset.visibility === 'shared';

  return (
    <>
      <IconButton
        edge="end"
        size="small"
        aria-label={`More for ${preset.name}`}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <MoreHorizIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={close}
        slotProps={{ list: { 'aria-label': preset.name } }}
      >
        {[
          item('Open', onOpen, !canOpen),
          ...(owned ? [item('Edit…', onEdit, !canOpen)] : []),
          item('Duplicate', onDuplicate),
          ...(onCopyActionFile ? [item('Copy as action file', onCopyActionFile)] : []),
          ...(owned
            ? [
                item(shared ? 'Make private' : 'Share with everyone', () =>
                  onVisibility(shared ? 'private' : 'shared'),
                ),
                item('Delete…', () => setConfirming(true)),
              ]
            : [item(preset.hidden ? 'Unhide' : 'Hide', () => onHidden(!preset.hidden))]),
        ]}
      </Menu>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        aria-labelledby={`delete-${preset.presetId}`}
      >
        <DialogTitle id={`delete-${preset.presetId}`}>Delete "{preset.name}"?</DialogTitle>
        <DialogContent>
          {shared ? 'Everyone loses it, not only you.' : 'It cannot be brought back.'}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              setConfirming(false);
              onDelete();
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
