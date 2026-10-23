import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Collapse from '@mui/material/Collapse';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import type { MenuNode } from './menuTree';

export interface SubMenuProps<T> {
  title: string;
  /** Items below a folder. */
  count?: number;
  nodes: MenuNode<T>[];
  /** Expanded while searching. */
  forceOpen?: boolean;
  onSelect: (item: T) => void;
  /** The line under an item. */
  caption?: (item: T) => string;
  /** A button at the end of an item's row, such as a ⋯ menu. */
  itemAction?: (item: T) => ReactNode;
  /** Nesting level, for indentation. */
  depth?: number;
}

/** Recursive collapsible list; folders are keyed by full path and show how many items they hold. */
export function SubMenu<T>({
  title,
  count,
  nodes,
  forceOpen = false,
  onSelect,
  caption,
  itemAction,
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
        {count !== undefined && (
          <Typography variant="caption" color="text.secondary" aria-hidden sx={{ mx: 1 }}>
            {count}
          </Typography>
        )}
        {expanded ? <ExpandLess /> : <ExpandMore />}
      </ListItemButton>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <List disablePadding dense>
          {nodes.map((n) =>
            n.kind === 'folder' ? (
              <SubMenu
                key={`folder:${n.key}`}
                title={n.title}
                count={n.count}
                nodes={n.children}
                forceOpen={forceOpen}
                onSelect={onSelect}
                caption={caption}
                itemAction={itemAction}
                depth={depth + 1}
              />
            ) : (
              <ListItem key={`item:${n.key}`} disablePadding secondaryAction={itemAction?.(n.item)}>
                <ListItemButton sx={{ pl: 2 + (depth + 1) * 2 }} onClick={() => onSelect(n.item)}>
                  <ListItemText primary={n.label} secondary={caption?.(n.item) || undefined} />
                </ListItemButton>
              </ListItem>
            ),
          )}
        </List>
      </Collapse>
    </List>
  );
}
