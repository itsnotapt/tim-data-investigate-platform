import AddIcon from '@mui/icons-material/Add';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import { useMatch } from 'react-router';
import { ActionBarSlot } from '../components';
import { NewQueryMenu } from '../features/new-query';
import { useTabsStore } from '../features/tabs';

const ACTION_BAR_HEIGHT = 48;

/**
 * The grey bar across the top of the page, under the app bar: **New**, then what the action tab
 * on show puts in it (Run and its pills). On a page without an action tab, Run is disabled.
 */
export function ActionBar() {
  const tabId = useMatch('/view/:tabId')?.params.tabId;
  const onActionTab = useTabsStore((s) => tabId !== undefined && tabId in s.tabs);
  return (
    <Box
      role="region"
      aria-label="Action bar"
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minHeight: ACTION_BAR_HEIGHT,
        px: 1.5,
        bgcolor: 'action.hover',
        // Light primary text on the bar's grey is under 4.5:1.
        '& > .MuiButton-text': theme.applyStyles('light', { color: theme.palette.primary.dark }),
      })}
    >
      <NewQueryMenu size="small">
        <AddIcon fontSize="small" sx={{ mr: 0.5 }} />
        New
      </NewQueryMenu>
      {!onActionTab && (
        <Tooltip title="Open a query from the tree, or start a new one, to run it.">
          {/* A disabled button gets no pointer events, so the tooltip hangs on a wrapper. */}
          <span>
            <Button
              variant="contained"
              size="small"
              startIcon={<PlayArrowIcon />}
              disabled
              sx={{ px: 2 }}
            >
              Run
            </Button>
          </span>
        </Tooltip>
      )}
      <ActionBarSlot />
    </Box>
  );
}
