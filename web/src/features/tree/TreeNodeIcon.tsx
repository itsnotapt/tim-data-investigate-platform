import ErrorIcon from '@mui/icons-material/Warning';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import Badge from '@mui/material/Badge';
import CircularProgress from '@mui/material/CircularProgress';
import type { Tab } from '../tabs';
import { badgeText, badgeTone, nodeStatus } from './nodeStatus';

export interface TreeNodeIconProps {
  tab: Tab;
  open: boolean;
  active: boolean;
}

/** Spinner, red alert, row-count badge over a folder, or a faded folder. */
export function TreeNodeIcon({ tab, open, active }: TreeNodeIconProps) {
  const status = nodeStatus(tab);
  const Folder = open ? FolderOpenIcon : FolderIcon;
  const color = active ? 'primary' : 'inherit';
  if (status === 'executing') {
    return (
      <CircularProgress
        size={16}
        thickness={5}
        aria-label="Executing"
        data-testid="tree-icon"
        data-status="executing"
      />
    );
  }
  if (status === 'error') {
    return (
      <ErrorIcon color="error" titleAccess="Error" data-testid="tree-icon" data-status="error" />
    );
  }
  if (status === 'results') {
    const count = tab.state.rowCount ?? 0;
    const tone = badgeTone(tab);
    return (
      <Badge
        showZero
        overlap="circular"
        badgeContent={badgeText(count)}
        color={tone === 'default' ? 'default' : tone}
        data-testid="tree-icon"
        data-status="results"
        data-tone={tone}
        sx={{
          '& .MuiBadge-badge': {
            fontSize: 10,
            height: 16,
            minWidth: 16,
            px: 0.5,
            ...(tone === 'default' && { bgcolor: 'grey.700', color: 'common.white' }),
          },
        }}
      >
        <Folder color={color} />
      </Badge>
    );
  }
  return <Folder color={color} sx={{ opacity: 0.5 }} data-testid="tree-icon" data-status="draft" />;
}
