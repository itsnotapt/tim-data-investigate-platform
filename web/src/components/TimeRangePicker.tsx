import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useState } from 'react';
import { TIME_RANGE_PRESETS, timeRangeLabel, type TimeRange } from '../lib/time-range';
import { CustomDateRangeDialog, CustomPeriodDialog } from './TimeRangePickerDialogs';

export interface TimeRangePickerProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  disabled?: boolean;
}

type Custom = 'date' | 'period' | null;

/** "Time range: <label>" button with presets and the custom dialogs. */
export function TimeRangePicker({ value, onChange, disabled }: TimeRangePickerProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [custom, setCustom] = useState<Custom>(null);
  const close = () => setAnchor(null);
  const pick = (range: TimeRange) => {
    onChange(range);
    setCustom(null);
  };

  return (
    <>
      <Button
        size="small"
        color="inherit"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={anchor ? true : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ borderRadius: 4 }}
      >
        Time range: {timeRangeLabel(value)}
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        <MenuItem
          onClick={() => {
            close();
            setCustom('date');
          }}
        >
          Custom Date Range
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            setCustom('period');
          }}
        >
          Custom Time Period
        </MenuItem>
        {TIME_RANGE_PRESETS.map((preset) => (
          <MenuItem
            key={timeRangeLabel(preset)}
            onClick={() => {
              close();
              pick(preset);
            }}
          >
            {timeRangeLabel(preset)}
          </MenuItem>
        ))}
      </Menu>
      <CustomDateRangeDialog
        open={custom === 'date'}
        value={value}
        onClose={() => setCustom(null)}
        onApply={pick}
      />
      <CustomPeriodDialog
        open={custom === 'period'}
        value={value}
        onClose={() => setCustom(null)}
        onApply={pick}
      />
    </>
  );
}
