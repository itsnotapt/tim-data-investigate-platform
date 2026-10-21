import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useState } from 'react';
import type { CatalogueParam } from '../../lib/api';
import {
  TIMESPAN_UNITS,
  timespanParts,
  timespanSeconds,
  timespanValue,
  type TimespanUnit,
} from './paramValues';

/** The lookbacks analysts use most. */
const PRESETS = [
  ['15 minutes', 'PT15M'],
  ['1 hour', 'PT1H'],
  ['1 day', 'P1D'],
  ['7 days', 'P7D'],
  ['30 days', 'P30D'],
] as const;

export interface TimespanEditorProps {
  param: CatalogueParam;
  value: unknown;
  /** `undefined` unsets the param. */
  onChange: (value: unknown) => void;
  onDone: () => void;
}

/** A timespan as an amount of a unit, or one of the presets. Empty amount unsets it. */
export function TimespanEditor({ param, value, onChange, onDone }: TimespanEditorProps) {
  const [draft, setDraft] = useState<{ amount: string; unit: TimespanUnit }>(() => {
    const seconds = typeof value === 'string' ? timespanSeconds(value) : null;
    if (seconds === null) return { amount: '', unit: 'minutes' };
    const { amount, unit } = timespanParts(seconds);
    return { amount: String(amount), unit };
  });
  const commit = (amount: string, unit: TimespanUnit) => {
    setDraft({ amount, unit });
    const n = Number(amount);
    if (amount.trim() === '') onChange(undefined);
    else if (Number.isFinite(n) && n >= 0) onChange(timespanValue(n, unit));
  };
  return (
    <Box sx={{ width: 320 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
        {PRESETS.map(([label, preset]) => (
          <Chip
            key={preset}
            size="small"
            label={label}
            color={value === preset ? 'primary' : 'default'}
            onClick={() => {
              onChange(preset);
              onDone();
            }}
          />
        ))}
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          type="number"
          autoFocus
          label={param.title}
          value={draft.amount}
          helperText={param.help}
          onChange={(e) => commit(e.target.value, draft.unit)}
          slotProps={{ htmlInput: { min: 0 } }}
          sx={{ flex: 1 }}
        />
        <TextField
          select
          size="small"
          label="Unit"
          value={draft.unit}
          onChange={(e) => commit(draft.amount, e.target.value as TimespanUnit)}
          sx={{ width: 130 }}
        >
          {TIMESPAN_UNITS.map(([unit]) => (
            <MenuItem key={unit} value={unit}>
              {unit}
            </MenuItem>
          ))}
        </TextField>
      </Box>
    </Box>
  );
}
