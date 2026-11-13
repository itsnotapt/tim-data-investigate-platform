import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import TableRowsOutlinedIcon from '@mui/icons-material/TableRowsOutlined';
import Box from '@mui/material/Box';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { Fragment } from 'react';

/** What a Fixed input does, as labelled lines: the same for every input. */
const FIXED_LINES: [string, string][] = [
  ['Value', 'saved with the preset, as it is now'],
  ['Tabs', 'every tab opened from the preset starts with it'],
];

/** What a From row input does, as labelled lines: the same for every input. */
const ROW_LINES: [string, string][] = [
  ['Value', 'the first of its columns with a value in the row'],
  ['Several rows', 'must match, unless the input takes a list'],
  ['Right-click', 'offered on rows that have one of its columns'],
  ['New menu', 'the tab asks for it'],
];

const Lines = ({ lines }: { lines: [string, string][] }) => (
  <Box
    component="span"
    sx={{ display: 'grid', gridTemplateColumns: '84px 1fr', columnGap: 1.5, rowGap: 0.25, mt: 0.5 }}
  >
    {lines.map(([label, line]) => (
      <Fragment key={label}>
        <Box component="span" sx={{ color: 'text.primary', whiteSpace: 'nowrap' }}>
          {label}
        </Box>
        <span>{line}</span>
      </Fragment>
    ))}
  </Box>
);

const FixedIcon = PushPinOutlinedIcon;
const RowIcon = TableRowsOutlinedIcon;
const option = { alignItems: 'flex-start', whiteSpace: 'normal', py: 1 } as const;

/**
 * Where an input's value comes from: Fixed or From row. Closed, it shows an icon and the choice on
 * one line; open, each option describes what it does.
 */
export function SourceSelect({
  fixed,
  onChange,
}: {
  fixed: boolean;
  onChange: (fixed: boolean) => void;
}) {
  return (
    <TextField
      select
      size="small"
      value={fixed ? 'fixed' : 'row'}
      onChange={(e) => onChange(e.target.value === 'fixed')}
      sx={{ width: 136, flexShrink: 0 }}
      slotProps={{
        htmlInput: { 'aria-label': 'Source' },
        select: {
          renderValue: (value) => (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              {value === 'fixed' ? (
                <FixedIcon sx={{ fontSize: 18 }} color="action" />
              ) : (
                <RowIcon sx={{ fontSize: 18 }} color="primary" />
              )}
              <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
                {value === 'fixed' ? 'Fixed' : 'From row'}
              </Box>
            </Stack>
          ),
          MenuProps: { slotProps: { paper: { sx: { maxWidth: 480 } } } },
        },
      }}
    >
      <MenuItem value="fixed" sx={option}>
        <ListItemIcon sx={{ mt: 0.25 }}>
          <FixedIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Fixed" secondary={<Lines lines={FIXED_LINES} />} />
      </MenuItem>
      <MenuItem value="row" sx={option}>
        <ListItemIcon sx={{ mt: 0.25 }}>
          <RowIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="From row" secondary={<Lines lines={ROW_LINES} />} />
      </MenuItem>
    </TextField>
  );
}
