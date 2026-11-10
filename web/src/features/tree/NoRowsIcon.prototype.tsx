/* eslint-disable react-refresh/only-export-components -- PROTOTYPE */
/**
 * PROTOTYPE — throwaway. Lives on branch prototype/tree-no-rows-icon only; never merge into main.
 *
 * Question: what should a tree node look like when its run succeeded with no rows, instead of the
 * ringed "0"? Five variants of the noRows icon, switchable via `?variant=` on the real app.
 * Every other status renders as on main, so each variant sits next to the real badges.
 */
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import type { Tab } from '../tabs';
import { badgeTone } from './nodeStatus';
import type { PrototypeVariant } from '../../components/PrototypeSwitcher.prototype';
import { usePrototypeVariant } from '../../components/PrototypeSwitcher.prototype';

export const NO_ROWS_VARIANTS = [
  { key: 'A', name: 'Current: ringed 0' },
  { key: 'B', name: 'Folder + grey 0 badge, like the row-count badge' },
  { key: 'C', name: 'Folder + solid dot' },
  { key: 'D', name: 'Folder + hollow ring dot' },
  { key: 'E', name: 'Plain colour circle, no folder' },
] as const satisfies readonly PrototypeVariant[];

const common = {
  role: 'img',
  'aria-label': 'Succeeded, no rows',
  title: 'Succeeded, no rows',
  'data-testid': 'tree-icon',
  'data-status': 'noRows',
} as const;

/** Unvisited no-rows nodes take the blue "new" tone, like the row-count badge. */
const dotColor = (tab: Tab) => (badgeTone(tab) === 'info' ? 'info.main' : 'grey.600');

export function NoRowsIconPrototype({
  tab,
  open,
  active,
}: {
  tab: Tab;
  open: boolean;
  active: boolean;
}) {
  const variant = usePrototypeVariant(NO_ROWS_VARIANTS);
  const Folder = open ? FolderOpenIcon : FolderIcon;
  const color = active ? 'primary' : 'inherit';
  const tone = badgeTone(tab);

  if (variant === 'B') {
    return (
      <Badge
        {...common}
        component="span"
        overlap="circular"
        badgeContent="0"
        showZero
        color={tone === 'default' ? 'default' : tone}
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

  if (variant === 'C' || variant === 'D') {
    const hollow = variant === 'D';
    return (
      <Badge
        {...common}
        component="span"
        overlap="circular"
        variant="dot"
        sx={{
          '& .MuiBadge-badge': {
            width: 10,
            height: 10,
            minWidth: 10,
            borderRadius: '50%',
            bgcolor: hollow ? 'background.paper' : dotColor(tab),
            border: hollow ? 2 : 0,
            borderColor: dotColor(tab),
            boxSizing: 'border-box',
          },
        }}
      >
        <Folder color={color} />
      </Badge>
    );
  }

  if (variant === 'E') {
    return (
      <Box
        component="span"
        {...common}
        sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24 }}
      >
        <Box
          component="span"
          sx={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            bgcolor: active ? 'primary.main' : dotColor(tab),
          }}
        />
      </Box>
    );
  }

  // A: the ringed 0 from main.
  return (
    <Box
      component="span"
      {...common}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        borderRadius: '50%',
        border: 2,
        borderColor: active ? 'primary.main' : 'text.secondary',
        color: active ? 'primary.main' : 'text.secondary',
        fontSize: 10,
        fontWeight: 'bold',
        lineHeight: 1,
      }}
    >
      0
    </Box>
  );
}
