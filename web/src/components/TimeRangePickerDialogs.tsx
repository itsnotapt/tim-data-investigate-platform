import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { useState } from 'react';
import {
  formatUtcDate,
  formatUtcTime,
  parseCustomDateRange,
  parseCustomPeriod,
  resolveTimeRange,
  type AbsoluteTimeRange,
  type RelativeTimeRange,
  type TimeRange,
  type TimeUnit,
} from '../lib/time-range';
import { DraggableDialog } from './DraggableDialog';

function ErrorList({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <Box component="ul" role="alert" sx={{ color: 'error.main', m: 0, mt: 1, pl: 3 }}>
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </Box>
  );
}

interface DialogBase {
  open: boolean;
  /** Current range; prefills the form. */
  value: TimeRange;
  onClose: () => void;
}

export interface CustomDateRangeDialogProps extends DialogBase {
  onApply: (range: AbsoluteTimeRange) => void;
}

function DateRangeForm({ value, onClose, onApply }: Omit<CustomDateRangeDialogProps, 'open'>) {
  const { start, end } = resolveTimeRange(value);
  const [fields, setFields] = useState({
    startDate: formatUtcDate(start),
    startTime: formatUtcTime(start),
    endDate: formatUtcDate(end),
    endTime: formatUtcTime(end),
  });
  const [errors, setErrors] = useState<string[]>([]);
  const set = (key: keyof typeof fields) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));
  const today = formatUtcDate(new Date());

  const apply = () => {
    const parsed = parseCustomDateRange(fields);
    if (!parsed.ok) return setErrors(parsed.errors);
    onApply(parsed.value);
  };

  return (
    <DraggableDialog
      open
      onClose={onClose}
      title="Custom date range"
      fullWidth
      maxWidth="xs"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={apply}>Apply</Button>
        </>
      }
    >
      <TextField
        label="Start date"
        type="date"
        value={fields.startDate}
        onChange={set('startDate')}
        slotProps={{ htmlInput: { max: today }, inputLabel: { shrink: true } }}
        fullWidth
        margin="dense"
      />
      <TextField
        label="Start time"
        value={fields.startTime}
        onChange={set('startTime')}
        placeholder="HH:MM"
        fullWidth
        margin="dense"
      />
      <TextField
        label="End date"
        type="date"
        value={fields.endDate}
        onChange={set('endDate')}
        slotProps={{ htmlInput: { max: today }, inputLabel: { shrink: true } }}
        fullWidth
        margin="dense"
      />
      <TextField
        label="End time"
        value={fields.endTime}
        onChange={set('endTime')}
        placeholder="HH:MM"
        fullWidth
        margin="dense"
      />
      <ErrorList errors={errors} />
    </DraggableDialog>
  );
}

/** "Custom date range" (screen 09): UTC dates and HH:MM times. The form resets on each open. */
export function CustomDateRangeDialog({ open, ...rest }: CustomDateRangeDialogProps) {
  return open ? <DateRangeForm {...rest} /> : null;
}

export interface CustomPeriodDialogProps extends DialogBase {
  onApply: (range: RelativeTimeRange) => void;
}

const UNITS: TimeUnit[] = ['minutes', 'hours', 'days'];

function PeriodForm({ value, onClose, onApply }: Omit<CustomPeriodDialogProps, 'open'>) {
  const [startAmount, setStartAmount] = useState(
    value.kind === 'relative' ? String(value.start.amount) : '',
  );
  const [startUnit, setStartUnit] = useState<TimeUnit>(
    value.kind === 'relative' ? value.start.unit : 'minutes',
  );
  const [endAmount, setEndAmount] = useState(
    value.kind === 'relative' && value.end ? String(value.end.amount) : '',
  );
  const [endUnit, setEndUnit] = useState<TimeUnit | 'now'>(
    value.kind === 'relative' && value.end ? value.end.unit : 'now',
  );
  const [errors, setErrors] = useState<string[]>([]);

  const apply = () => {
    const parsed = parseCustomPeriod({ startAmount, startUnit, endUnit, endAmount });
    if (!parsed.ok) return setErrors(parsed.errors);
    onApply(parsed.value);
  };

  return (
    <DraggableDialog
      open
      onClose={onClose}
      title="Custom time period"
      fullWidth
      maxWidth="xs"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={apply}>Apply</Button>
        </>
      }
    >
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label="Start time period"
          value={startAmount}
          onChange={(e) => setStartAmount(e.target.value)}
          margin="dense"
          fullWidth
        />
        <TextField
          select
          label="Start time units"
          value={startUnit}
          onChange={(e) => setStartUnit(e.target.value as TimeUnit)}
          slotProps={{ select: { native: true } }}
          margin="dense"
          fullWidth
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </TextField>
      </Box>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label="End time period"
          value={endAmount}
          onChange={(e) => setEndAmount(e.target.value)}
          disabled={endUnit === 'now'}
          margin="dense"
          fullWidth
        />
        <TextField
          select
          label="End time units"
          value={endUnit}
          onChange={(e) => setEndUnit(e.target.value as TimeUnit | 'now')}
          slotProps={{ select: { native: true } }}
          margin="dense"
          fullWidth
        >
          {['now', ...UNITS].map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </TextField>
      </Box>
      <ErrorList errors={errors} />
    </DraggableDialog>
  );
}

/** "Custom time period" (screen 10): "N <unit> ago" start, end "now" or "M <unit> ago". */
export function CustomPeriodDialog({ open, ...rest }: CustomPeriodDialogProps) {
  return open ? <PeriodForm {...rest} /> : null;
}
