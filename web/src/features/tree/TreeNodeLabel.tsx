import Box from '@mui/material/Box';
import type { Tab } from '../tabs';
import { isNew, labelPrefix } from './nodeStatus';

/** `[draft] ` / `[new] ` prefix plus title; medium weight while new. */
export function TreeNodeLabel({ tab }: { tab: Tab }) {
  return (
    <Box
      component="span"
      sx={{ fontSize: '0.8125rem', lineHeight: 1.2, whiteSpace: 'break-spaces' }}
    >
      {labelPrefix(tab)}
      <Box component="span" sx={{ fontWeight: isNew(tab) ? 500 : 400 }}>
        {tab.title}
      </Box>
    </Box>
  );
}
