import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Collapse from '@mui/material/Collapse';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { useState } from 'react';
import type { MenuNode } from './menuTree';

export interface SubMenuProps<T> {
  title: string;
  nodes: MenuNode<T>[];
  /** Expanded while searching. */
  forceOpen?: boolean;
  onSelect: (item: T) => void;
  /** Nesting level, for indentation. */
  depth?: number;
}

/** Recursive collapsible list; folders are keyed by full path. */
export function SubMenu<T>({
  title,
  nodes,
  forceOpen = false,
  onSelect,
  depth = 0,
}: SubMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const expanded = forceOpen || open;
  return (
    <List disablePadding dense>
      <ListItemButton
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expanded}
        sx={{ pl: 2 + depth * 2 }}
      >
        <ListItemText primary={title} />
        {expanded ? <ExpandLess /> : <ExpandMore />}
      </ListItemButton>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <List disablePadding dense>
          {nodes.map((n) =>
            n.kind === 'folder' ? (
              <SubMenu
                key={`folder:${n.key}`}
                title={n.title}
                nodes={n.children}
                forceOpen={forceOpen}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ) : (
              <ListItemButton
                key={`item:${n.key}`}
                sx={{ pl: 2 + (depth + 1) * 2 }}
                onClick={() => onSelect(n.item)}
              >
                <ListItemText primary={n.label} />
              </ListItemButton>
            ),
          )}
        </List>
      </Collapse>
    </List>
  );
}
