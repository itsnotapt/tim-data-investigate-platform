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
import type { ColumnView } from '../../lib/api';

export interface ViewMoreMenuProps {
  view: ColumnView;
  onHidden: (hidden: boolean) => void;
  onDelete: () => void;
}

/** A column view's ⋯ menu: anyone hides or unhides it for themselves; the owner deletes it. */
export function ColumnViewMoreMenu({ view, onHidden, onDelete }: ViewMoreMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const close = () => setAnchor(null);
  const shared = view.visibility === 'shared';

  return (
    <>
      <IconButton
        edge="end"
        size="small"
        aria-label={`More for ${view.name}`}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <MoreHorizIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={close}
        slotProps={{ list: { 'aria-label': view.name } }}
      >
        <MenuItem
          onClick={() => {
            close();
            onHidden(!view.hidden);
          }}
        >
          {view.hidden ? 'Unhide' : 'Hide'}
        </MenuItem>
        {view.owned && (
          <MenuItem
            onClick={() => {
              close();
              setConfirming(true);
            }}
          >
            Delete…
          </MenuItem>
        )}
      </Menu>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        aria-labelledby={`delete-${view.viewId}`}
      >
        <DialogTitle id={`delete-${view.viewId}`}>Delete "{view.name}"?</DialogTitle>
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
