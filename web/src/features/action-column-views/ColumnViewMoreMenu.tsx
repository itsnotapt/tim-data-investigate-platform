import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useId, useState } from 'react';
import type { ColumnView } from '../../lib/api';

export interface ColumnViewMenuItem {
  label: string;
  onClick: () => void;
}

export interface ViewMoreMenuProps {
  /** The row's name, which the button and the menu are labelled with. */
  name: string;
  items: ColumnViewMenuItem[];
  /** The column view Delete… deletes, after a confirm; left out when there's no Delete…. */
  deleting?: ColumnView;
  onDelete?: () => void;
}

/** A row's ⋯ menu in the Views panel: `items`, then Delete… when `deleting` is given. */
export function ColumnViewMoreMenu({ name, items, deleting, onDelete }: ViewMoreMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const close = () => setAnchor(null);

  return (
    <>
      <IconButton
        edge="end"
        size="small"
        aria-label={`More for ${name}`}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <MoreHorizIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={close}
        slotProps={{ list: { 'aria-label': name } }}
      >
        {items.map((item) => (
          <MenuItem
            key={item.label}
            onClick={() => {
              close();
              item.onClick();
            }}
          >
            {item.label}
          </MenuItem>
        ))}
        {deleting && (
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
      {deleting && (
        <Dialog open={confirming} onClose={() => setConfirming(false)} aria-labelledby={titleId}>
          <DialogTitle id={titleId}>Delete "{deleting.name}"?</DialogTitle>
          <DialogContent>
            {deleting.visibility === 'shared'
              ? 'Everyone loses it, not only you.'
              : 'It cannot be brought back.'}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button
              color="error"
              onClick={() => {
                setConfirming(false);
                onDelete?.();
              }}
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
