import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import { useState, type ReactNode } from 'react';
import { isRequired, type FormField } from './paramRules';

export interface ParamFieldProps {
  name: string;
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Suggestions for `match` / `multiple`: the value when edit mode started. */
  initialValue?: unknown;
  /** Error text to show (validation failed). */
  error?: string;
}

/** Above this many selections the select shows "first, (+N others)". */
const MAX_LISTED = 5;
const SELECT_ALL = '\u0000select-all';

const scalar = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStrings = (v: unknown): string[] => asList(v).map(String);

interface MatchOption {
  column: string;
  value: unknown;
}
const isMatchOption = (v: unknown): v is MatchOption =>
  typeof v === 'object' && v !== null && 'column' in v && 'value' in v;

function Label({ name, required }: { name: string; required: boolean }) {
  return (
    <>
      {name}
      {required && (
        <Box component="span" aria-hidden="true" sx={{ color: 'error.main' }}>
          {' *'}
        </Box>
      )}
    </>
  );
}

/**
 * One input of the template form. Widget by type: `array`
 * select (optionally `multiple` with Select All), `match` select of `{column, value}`,
 * `multiple` chips combobox (`,` / `;` delimit), `boolean` switch, anything else a trimmed
 * text field.
 */
export function ParamField({ name, field, value, onChange, initialValue, error }: ParamFieldProps) {
  const required = isRequired(field);
  const hint = (field as { hint?: string | null }).hint ?? undefined;
  const helper: ReactNode = error ?? hint;
  const common = {
    label: <Label name={name} required={required} />,
    helperText: helper,
    error: error !== undefined,
    fullWidth: true,
    margin: 'dense' as const,
    size: 'small' as const,
  };

  if (field.type === 'array') return <ArrayField {...{ field, value, onChange, common }} />;

  if (field.type === 'match' && typeof initialValue === 'object' && initialValue !== null) {
    const options = asList(initialValue).filter(isMatchOption);
    const selected = asList(value).filter(isMatchOption)[0];
    const key = (o: MatchOption) => `${o.column}: ${String(o.value)}`;
    return (
      <TextField
        {...common}
        select
        value={selected ? key(selected) : ''}
        onChange={(e) => {
          const picked = options.find((o) => key(o) === e.target.value);
          onChange(picked ? [picked] : []);
        }}
      >
        {options.map((o) => (
          <MenuItem key={key(o)} value={key(o)}>
            {key(o)}
          </MenuItem>
        ))}
      </TextField>
    );
  }

  if (field.type === 'multiple') {
    return (
      <MultipleField {...{ common, value, onChange }} options={asStrings(initialValue ?? value)} />
    );
  }

  if (field.type === 'boolean') {
    return (
      <div>
        <FormControlLabel
          label={name}
          control={<Switch checked={value === true} onChange={(_, c) => onChange(c)} />}
        />
        {hint && <FormHelperText sx={{ mt: -0.5, ml: 1.75 }}>{hint}</FormHelperText>}
      </div>
    );
  }

  return (
    <TextField
      {...common}
      value={scalar(value)}
      onChange={(e) => onChange(e.target.value.trim())}
    />
  );
}

interface CommonProps {
  label: ReactNode;
  helperText: ReactNode;
  error: boolean;
  fullWidth: boolean;
  margin: 'dense';
  size: 'small';
}

function ArrayField({
  field,
  value,
  onChange,
  common,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  common: CommonProps;
}) {
  const values = (field as { values?: string[] | null }).values ?? [];
  const multiple = (field as { multiple?: boolean | null }).multiple === true;
  const selected = multiple ? asStrings(value) : scalar(value);
  // Stored values that are no longer offered stay visible so they can be deselected.
  const extra = (
    multiple ? (selected as string[]) : selected === '' ? [] : [selected as string]
  ).filter((v) => !values.includes(v));
  const options = [...values, ...extra];

  const toggleAll = () => {
    const list = selected as string[];
    onChange(list.length === values.length ? [] : values.slice());
  };

  return (
    <TextField
      {...common}
      select
      value={selected}
      onChange={(e) => {
        const next = e.target.value as unknown;
        if (Array.isArray(next) && next.includes(SELECT_ALL)) toggleAll();
        else onChange(next);
      }}
      slotProps={{
        select: {
          multiple,
          renderValue: multiple
            ? (v) => {
                const list = v as string[];
                return list.length <= MAX_LISTED
                  ? list.join(', ')
                  : `${list[0] ?? ''}, (+${list.length - 1} others)`;
              }
            : undefined,
        },
      }}
    >
      {multiple && [
        <MenuItem key="__all" value={SELECT_ALL}>
          <ListItemIcon>
            <Checkbox
              edge="start"
              disableRipple
              checked={
                (selected as string[]).length > 0 && (selected as string[]).length === values.length
              }
              indeterminate={
                (selected as string[]).length > 0 && (selected as string[]).length < values.length
              }
            />
          </ListItemIcon>
          <ListItemText primary="Select All" />
        </MenuItem>,
        <Divider key="__div" />,
      ]}
      {options.map((o) => (
        <MenuItem key={o} value={o}>
          {multiple && (
            <ListItemIcon>
              <Checkbox edge="start" disableRipple checked={(selected as string[]).includes(o)} />
            </ListItemIcon>
          )}
          <ListItemText primary={o} />
        </MenuItem>
      ))}
    </TextField>
  );
}

function MultipleField({
  common,
  value,
  onChange,
  options,
}: {
  common: CommonProps;
  value: unknown;
  onChange: (v: unknown) => void;
  options: string[];
}) {
  const [input, setInput] = useState('');
  const list = asStrings(value);

  const commit = (text: string) => {
    const parts = text
      .split(/[,;]/)
      .map((p) => p.trim())
      .filter((p) => p !== '' && !list.includes(p));
    if (parts.length > 0) onChange([...list, ...parts]);
  };

  return (
    <Autocomplete
      multiple
      freeSolo
      autoSelect
      size="small"
      options={options}
      value={list}
      inputValue={input}
      onChange={(_, v) => onChange(v.map(String))}
      onInputChange={(_, text, reason) => {
        if (reason === 'input' && /[,;]/.test(text)) {
          commit(text);
          setInput('');
        } else {
          setInput(text);
        }
      }}
      renderValue={(v, getItemProps) =>
        v.map((option, index) => {
          const { key, ...props } = getItemProps({ index });
          return <Chip key={key} size="small" label={option} {...props} />;
        })
      }
      renderInput={(params) => <TextField {...params} {...common} />}
    />
  );
}
