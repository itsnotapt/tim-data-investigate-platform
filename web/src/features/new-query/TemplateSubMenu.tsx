import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Collapse from '@mui/material/Collapse';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { useState } from 'react';
import type { MenuNode } from './templateMenuTree';
import type { QueryTemplate } from './types';

export interface TemplateSubMenuProps {
  title: string;
  nodes: MenuNode[];
  /** Expanded while searching. */
  forceOpen?: boolean;
  onSelect: (template: QueryTemplate) => void;
  /** Nesting level, for indentation. */
  depth?: number;
}

/** Recursive collapsible list; folders are keyed by full path (BUG-35). */
export function TemplateSubMenu({
  title,
  nodes,
  forceOpen = false,
  onSelect,
  depth = 0,
}: TemplateSubMenuProps) {
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
              <TemplateSubMenu
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
                onClick={() => onSelect(n.template)}
              >
                <ListItemText primary={n.template.menu} />
              </ListItemButton>
            ),
          )}
        </List>
      </Collapse>
    </List>
  );
}
