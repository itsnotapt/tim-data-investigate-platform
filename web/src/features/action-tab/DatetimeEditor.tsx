import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { DateTimeField } from '@mui/x-date-pickers/DateTimeField';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { MultiSectionDigitalClock } from '@mui/x-date-pickers/MultiSectionDigitalClock';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { CatalogueParam } from '../../lib/api';
import { parseParamText } from './paramValues';

dayjs.extend(utc);

/** Kusto stores and shows times in UTC, so the analyst picks them in UTC. */
const TIMEZONE = 'UTC';

export interface DatetimeEditorProps {
  param: CatalogueParam;
  value: unknown;
  /** `undefined` unsets the param. */
  onChange: (value: unknown) => void;
  onDone: () => void;
}

/** The ISO 8601 value the param holds, in UTC with `Z`, milliseconds only when there are some. */
function datetimeValue(d: Dayjs): string {
  const u = d.utc();
  return u.format(u.millisecond() === 0 ? 'YYYY-MM-DDTHH:mm:ss[Z]' : 'YYYY-MM-DDTHH:mm:ss.SSS[Z]');
}

function current(value: unknown): Dayjs | null {
  if (typeof value !== 'string' || parseParamText('datetime', value).error !== undefined) {
    return null;
  }
  return dayjs.utc(value);
}

/**
 * A datetime in UTC: a field to type in (or paste an ISO datetime into, such as one copied from a
 * result row), a calendar and a clock.
 */
export function DatetimeEditor({ param, value, onChange, onDone }: DatetimeEditorProps) {
  const date = current(value);
  const set = (d: Dayjs | null) => {
    if (d === null) onChange(undefined);
    else if (d.isValid()) onChange(datetimeValue(d));
  };
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box
        onPasteCapture={(e) => {
          const text = e.clipboardData.getData('text').trim();
          if (parseParamText('datetime', text).error !== undefined) return;
          e.preventDefault();
          e.stopPropagation();
          set(dayjs.utc(text));
        }}
      >
        <DateTimeField
          autoFocus
          fullWidth
          size="small"
          label={`${param.title} (UTC)`}
          format="YYYY-MM-DD HH:mm:ss"
          ampm={false}
          timezone={TIMEZONE}
          value={date}
          onChange={set}
          helperText={param.help}
          sx={{ mt: 1 }}
        />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
        <DateCalendar timezone={TIMEZONE} value={date} onChange={set} />
        <MultiSectionDigitalClock
          timezone={TIMEZONE}
          ampm={false}
          views={['hours', 'minutes', 'seconds']}
          value={date}
          onChange={set}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          size="small"
          onClick={() => {
            onChange(undefined);
            onDone();
          }}
        >
          Not set
        </Button>
      </Box>
    </LocalizationProvider>
  );
}
