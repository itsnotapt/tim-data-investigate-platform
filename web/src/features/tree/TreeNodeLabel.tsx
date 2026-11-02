import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { tabTitle } from '../action-tab/tabTitle';
import type { Tab } from '../tabs';
import { isNew, labelPrefix } from './nodeStatus';

/**
 * `[draft] ` / `[new] ` prefix plus title, cut to two lines with the full title in a tooltip;
 * medium weight while new.
 */
export function TreeNodeLabel({ tab }: { tab: Tab }) {
  const title = tabTitle(tab);
  return (
    <Tooltip title={title} placement="right">
      <Box
        component="span"
        sx={{
          fontSize: '0.8125rem',
          lineHeight: 1.2,
          whiteSpace: 'break-spaces',
          minWidth: 0,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {labelPrefix(tab)}
        <Box component="span" sx={{ fontWeight: isNew(tab) ? 500 : 400 }}>
          {title}
        </Box>
      </Box>
    </Tooltip>
  );
}
