import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { detailEntries } from './detailText';

export const DETAIL_PANEL_WIDTH = 900;

export interface DetailPanelProps {
  open: boolean;
  data: Record<string, unknown> | null | undefined;
  onClose: () => void;
}

/**
 * Right-hand drawer with the fields of one row (legacy `DetailSidePanel.vue`, screen 24).
 * Persistent (no overlay, the grid stays usable) and absolutely positioned in the grid's
 * container, so a hidden tab hides it too. BUG-41: the close icon is visible here.
 */
export function DetailPanel({ open, data, onClose }: DetailPanelProps) {
  const entries = detailEntries(data);
  return (
    <Drawer
      variant="persistent"
      anchor="right"
      open={open}
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        // The root needs the width: the absolutely positioned paper resolves its percentages
        // against it (a zero-width root collapsed the paper to its min-content).
        width: DETAIL_PANEL_WIDTH,
        maxWidth: '100%',
        zIndex: 2,
        pointerEvents: 'none',
      }}
      slotProps={{
        paper: {
          'aria-label': 'Result details',
          sx: {
            position: 'absolute',
            width: '100%',
            pointerEvents: 'auto',
            p: 2,
          },
        },
      }}
    >
      <Box sx={{ textAlign: 'right' }}>
        <IconButton aria-label="Close details" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Accordion defaultExpanded disableGutters elevation={0} square>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>Result Details</AccordionSummary>
        <AccordionDetails sx={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
          <Box
            component="dl"
            sx={{ display: 'grid', gridTemplateColumns: '250px auto', fontSize: '0.9rem', m: 0 }}
          >
            {entries.map(({ key, text }) => (
              <Box key={key} sx={{ display: 'contents' }}>
                <Box component="dt" sx={{ mt: '5px', fontWeight: 500, overflowWrap: 'anywhere' }}>
                  {key}
                </Box>
                <Box
                  component="dd"
                  sx={{
                    mt: '5px',
                    m: 0,
                    pl: '10px',
                    overflowWrap: 'anywhere',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {text}
                </Box>
              </Box>
            ))}
          </Box>
        </AccordionDetails>
      </Accordion>
    </Drawer>
  );
}
