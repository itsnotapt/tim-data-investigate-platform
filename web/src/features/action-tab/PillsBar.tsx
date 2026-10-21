import UndoIcon from '@mui/icons-material/Undo';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Popover from '@mui/material/Popover';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import type { CatalogueParam, InstanceConnection } from '../../lib/api';
import type { ParamErrors } from '../tabs/types';
import { DatetimeEditor } from './DatetimeEditor';
import { hasPill, isUnset, parseParamText, splitPasted, summarize, valueText } from './paramValues';
import { TimespanEditor } from './TimespanEditor';

export interface PillsBarProps {
  params: readonly CatalogueParam[];
  /** The tab's plain param values. */
  values: Record<string, unknown>;
  /** The instance's connections: the choices of a `connection` param. */
  connections: readonly InstanceConnection[];
  /** `undefined` unsets the param. */
  onChange: (name: string, value: unknown) => void;
  /** Why the server refused a param, by name; its pill is marked with the reason. */
  errors?: ParamErrors | null;
  /** Given when the values differ from the last run's: shows Edited, which resets them. */
  onReset?: () => void;
  /** Rendered at the right (Run). */
  end?: ReactNode;
}

interface EditorProps {
  param: CatalogueParam;
  value: unknown;
  connections: readonly InstanceConnection[];
  onChange: (value: unknown) => void;
  /** Closes the popover. */
  onDone: () => void;
}

interface Choice {
  value: unknown;
  label: string;
}

function choicesOf(
  param: CatalogueParam,
  connections: readonly InstanceConnection[],
): Choice[] | null {
  if (param.kind === 'connection') {
    return connections
      .filter((c) => c.type === param.connectionType)
      .map((c) => ({ value: c.name, label: c.title }));
  }
  if (param.choices && param.choices.length > 0) {
    return param.choices.map((c) => ({ value: c, label: valueText(c) }));
  }
  return null;
}

/** The list, or `undefined` (unset) when it is empty. */
function orUnset<T>(values: T[]): T[] | undefined {
  return values.length === 0 ? undefined : values;
}

/** A pick list: one value, or several in the choices' order for a many-valued param. */
function PickList({
  param,
  value,
  choices,
  onChange,
  onDone,
}: EditorProps & { choices: Choice[] }) {
  const picked = param.many && Array.isArray(value) ? value : [value];
  const isPicked = (c: Choice) => picked.some((v) => v === c.value);
  const pick = (v: unknown) => {
    onChange(v);
    onDone();
  };
  const toggle = (c: Choice) => {
    const next = choices.filter((each) => (each === c ? !isPicked(each) : isPicked(each)));
    onChange(orUnset(next.map((each) => each.value)));
  };
  return (
    <List dense role="listbox" aria-label={param.title} aria-multiselectable={param.many}>
      {!param.many && (
        <ListItemButton
          role="option"
          aria-selected={isUnset(value)}
          onClick={() => pick(undefined)}
        >
          <ListItemText primary="Not set" slotProps={{ primary: { color: 'text.secondary' } }} />
        </ListItemButton>
      )}
      {choices.map((c) => (
        <ListItemButton
          key={c.label}
          role="option"
          aria-selected={isPicked(c)}
          selected={!param.many && isPicked(c)}
          onClick={() => (param.many ? toggle(c) : pick(c.value))}
        >
          {param.many && (
            <Checkbox edge="start" size="small" checked={isPicked(c)} tabIndex={-1} disableRipple />
          )}
          <ListItemText primary={c.label} />
        </ListItemButton>
      ))}
    </List>
  );
}

/** Chips for a many-valued param: Enter adds the typed value, pasted text is split into values. */
function ChipsEditor({ param, value, onChange }: EditorProps) {
  const values: unknown[] = Array.isArray(value) ? value : [];
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = (texts: string[]) => {
    const next = [...values];
    for (const text of texts) {
      const parsed = parseParamText(param.kind, text);
      if (parsed.error !== undefined) {
        setError(`${text}: ${parsed.error}`);
        continue;
      }
      if (parsed.value !== undefined && !next.includes(parsed.value)) next.push(parsed.value);
    }
    onChange(orUnset(next));
  };
  return (
    <Box sx={{ width: 360 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: values.length > 0 ? 1 : 0 }}>
        {values.map((v, i) => (
          <Chip
            key={`${i}:${valueText(v)}`}
            size="small"
            label={valueText(v)}
            onDelete={() => {
              const next = values.filter((_, j) => j !== i);
              onChange(orUnset(next));
            }}
          />
        ))}
      </Box>
      <TextField
        size="small"
        fullWidth
        autoFocus
        placeholder="Type a value and press Enter, or paste several"
        value={input}
        error={error !== null}
        helperText={error}
        onChange={(e) => {
          setInput(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          setError(null);
          add([input]);
          setInput('');
        }}
        onPaste={(e) => {
          const parts = splitPasted(e.clipboardData.getData('text'));
          if (parts.length <= 1) return;
          e.preventDefault();
          setError(null);
          add(parts);
        }}
        slotProps={{ htmlInput: { 'aria-label': `Add ${param.title}` } }}
      />
    </Box>
  );
}

/** One value typed as text; it is committed while valid, and empty text unsets it. */
function TextEditor({ param, value, onChange }: EditorProps) {
  const [draft, setDraft] = useState(() => valueText(value));
  const parsed = parseParamText(param.kind, draft);
  const json = param.kind === 'json';
  return (
    <TextField
      size="small"
      autoFocus
      label={param.title}
      value={draft}
      multiline={json}
      minRows={json ? 4 : undefined}
      sx={{ width: json ? 480 : 320, mt: 1 }}
      error={parsed.error !== undefined}
      helperText={parsed.error ?? param.help}
      onChange={(e) => {
        setDraft(e.target.value);
        const next = parseParamText(param.kind, e.target.value);
        if (next.error === undefined) onChange(next.value);
      }}
      slotProps={{ htmlInput: { inputMode: param.kind === 'number' ? 'decimal' : undefined } }}
    />
  );
}

function Editor(props: EditorProps) {
  const { param, value, connections, onChange } = props;
  const choices = choicesOf(param, connections);
  if (choices) return <PickList {...props} choices={choices} />;
  if (param.kind === 'boolean') {
    return (
      <FormControlLabel
        label={param.title}
        control={
          <Switch
            autoFocus
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            slotProps={{ input: { role: 'switch' } }}
          />
        }
      />
    );
  }
  if (param.many) return <ChipsEditor {...props} />;
  if (param.kind === 'datetime') return <DatetimeEditor {...props} />;
  if (param.kind === 'timespan') return <TimespanEditor {...props} />;
  return <TextEditor {...props} />;
}

/** One pill per non-editor param, each edited in a popover by its kind. */
export function PillsBar({
  params,
  values,
  connections,
  onChange,
  errors,
  onReset,
  end,
}: PillsBarProps) {
  const [open, setOpen] = useState<{ name: string; anchor: HTMLElement } | null>(null);
  const pills = params.filter(hasPill);
  const editing = pills.find((p) => p.name === open?.name);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, px: 1, py: 0.5 }}>
      {pills.map((p) => {
        const error = errors?.[p.name];
        return (
          <Chip
            key={p.name}
            variant="outlined"
            color={error === undefined ? 'default' : 'error'}
            label={`${p.title}: ${summarize(p, values[p.name], connections)}`}
            title={error ?? p.help ?? undefined}
            onClick={(e) => setOpen({ name: p.name, anchor: e.currentTarget })}
            sx={
              isUnset(values[p.name]) && error === undefined
                ? { color: 'text.secondary' }
                : undefined
            }
          />
        );
      })}
      {pills.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No params
        </Typography>
      )}
      {onReset && (
        <Chip
          size="small"
          color="info"
          icon={<UndoIcon />}
          label="Edited"
          title="Reset to the params of the last run"
          onClick={onReset}
        />
      )}
      <Box sx={{ ml: 'auto' }}>{end}</Box>
      <Popover
        open={editing !== undefined}
        anchorEl={open?.anchor}
        onClose={() => setOpen(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: { role: 'dialog', 'aria-label': editing?.title, sx: { p: 1.5 } },
        }}
      >
        {editing && (
          <Editor
            key={editing.name}
            param={editing}
            value={values[editing.name]}
            connections={connections}
            onChange={(value) => onChange(editing.name, value)}
            onDone={() => setOpen(null)}
          />
        )}
      </Popover>
    </Box>
  );
}
