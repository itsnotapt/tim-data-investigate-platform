import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import type { CustomToolPanelProps } from 'ag-grid-react';
import { useContext, useMemo } from 'react';
import { NotifyContext } from '../../components/notifyContext';
import type { ActionFileOf } from './actionFileColumns';
import { copyColumnSettings } from './copyColumnSettings';
import type { ColumnViewController } from './useActionColumnView';
import { useTabColumnView } from './useTabColumnView';

/**
 * The Action file panel of an action tab's side bar: the tab's column layout as an action
 * file's `columns:` block, kept up to date as the columns change, with Copy.
 */
export function ActionFileToolPanel(props: CustomToolPanelProps) {
  const { columnViews, actionFile } = props.context as {
    columnViews: Pick<ColumnViewController, 'uuid'>;
    actionFile: ActionFileOf;
  };
  const { gridState } = useTabColumnView(columnViews.uuid);
  const notify = useContext(NotifyContext);
  const text = useMemo(() => (gridState ? actionFile(gridState) : null), [gridState, actionFile]);
  return (
    <Box sx={{ width: '100%', overflowY: 'auto', p: 1 }} data-testid="action-file-tool-panel">
      <Typography variant="body2" color="text.secondary">
        Paste into the action file to make its tabs start with these columns.
      </Typography>
      <Button
        size="small"
        variant="outlined"
        startIcon={<ContentCopyIcon />}
        disabled={text === null}
        onClick={() => text !== null && copyColumnSettings(text, notify)}
        sx={{ my: 1 }}
      >
        Copy
      </Button>
      {text !== null && (
        <Box
          component="pre"
          sx={{ m: 0, fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'pre' }}
        >
          {text}
        </Box>
      )}
    </Box>
  );
}
