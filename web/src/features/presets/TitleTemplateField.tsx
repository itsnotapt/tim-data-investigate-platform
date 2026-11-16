import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  fillIn,
  namesSomething,
  rowColumn,
  templateParts,
  type TemplatePart,
} from '../action-tab/titleTemplate';

export interface TitleTemplateFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** The names a placeholder can hold besides `row.` and a column. */
  names: ReadonlySet<string>;
  /** The placeholders to suggest, by what each names, in order. */
  suggestions: readonly string[];
  /** An example template, shown under the field while nothing is wrong with it. */
  example: string;
  /** What's wrong with the template, if anything. */
  error?: string;
  /** The pivot rows of the tab the template is for, if any. */
  pivotRows?: readonly Record<string, unknown>[];
}

/**
 * Whether the tab's `pivotRows` have the column a placeholder naming `name` names with `row.`:
 * `undefined` for a param, or without pivot rows.
 */
function rowsHave(
  name: string,
  pivotRows: readonly Record<string, unknown>[],
): boolean | undefined {
  const column = rowColumn(name);
  if (column === null || pivotRows.length === 0) return undefined;
  return pivotRows.some((row) => Object.hasOwn(row, column));
}

/**
 * What a suggestion of `name` says beside it, given the tab's pivot rows: for `row.X`, the value
 * the rows fill in, or that they have no `X`. Nothing for a param, or without pivot rows.
 */
function suggestionDetail(
  name: string,
  pivotRows: readonly Record<string, unknown>[],
): string | undefined {
  const has = rowsHave(name, pivotRows);
  if (has === undefined) return undefined;
  return has ? fillIn(`{${name}}`, { params: {}, pivotRows }) : "not in this tab's rows";
}

/**
 * The index of the `{` of the placeholder being typed at `caret` in `text`: the last `{` before
 * the caret, unless a `}` closes it first.
 */
function openBrace(text: string, caret: number | null): number | undefined {
  if (caret === null) return undefined;
  const before = text.slice(0, caret);
  const brace = before.lastIndexOf('{');
  return brace > before.lastIndexOf('}') ? brace : undefined;
}

/**
 * Where the placeholder being typed at `caret` in `text` ends: past its `}` when the caret is
 * inside a closed one, otherwise at the caret.
 */
function placeholderEnd(text: string, caret: number): number {
  const after = text.slice(caret);
  const close = after.indexOf('}');
  const nextBrace = after.indexOf('{');
  return close >= 0 && (nextBrace < 0 || close < nextBrace) ? caret + close + 1 : caret;
}

/** Where each of `parts` starts in the template they make up. */
function partStarts(parts: readonly TemplatePart[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const part of parts) {
    starts.push(at);
    at += ('text' in part ? part.text : part.placeholder).length;
  }
  return starts;
}

/** A `{row.X}` placeholder naming a column the tab's pivot rows lack, with why on hover. */
function MissingColumn({
  placeholder,
  column,
  caretIn,
  onPlaceCaret,
}: {
  placeholder: string;
  column: string;
  /** Whether the field's caret is inside the placeholder, which shows why too. */
  caretIn: boolean;
  /** Puts the field's caret inside the placeholder. */
  onPlaceCaret: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <Tooltip
      title={`This tab's rows have no ${column} column. Its tabs show <not set> for it until it's pivoted from rows that have one.`}
      open={hover || caretIn}
      arrow
      placement="top"
    >
      <Box
        component="span"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onMouseDown={(e) => {
          e.preventDefault();
          onPlaceCaret();
        }}
        sx={{
          color: 'warning.main',
          textDecoration: 'underline dotted',
          textUnderlineOffset: 3,
          // Hovered, unlike the rest of the overlay, which lets the pointer through to the field.
          pointerEvents: 'auto',
          cursor: 'help',
        }}
      >
        {placeholder}
      </Box>
    </Tooltip>
  );
}

/**
 * The Tab title of the Save preset dialog: a title template, its placeholders highlighted, the
 * unknown ones as errors and, given the tab's pivot rows, a `{row.X}` they lack as a warning.
 * Typing `{` suggests placeholders, filtered by what follows it: Enter or Tab inserts the first,
 * Escape closes the list.
 */
export function TitleTemplateField({
  value,
  onChange,
  names,
  suggestions,
  example,
  error,
  pivotRows = [],
}: TitleTemplateFieldProps) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const brace = openBrace(value, caret);
  const typed =
    brace === undefined || caret === null ? '' : value.slice(brace + 1, caret).toLowerCase();
  const matches =
    brace === undefined ? [] : suggestions.filter((name) => name.toLowerCase().includes(typed));
  const listId = `${id}-placeholders`;
  const optionId = (i: number) => `${id}-placeholder-${i}`;
  const parts = templateParts(value);
  const starts = partStarts(parts);
  const input = useRef<HTMLInputElement>(null);
  /** Where the caret goes once an inserted placeholder is in the field. */
  const insertedAt = useRef<number | null>(null);

  /** Scrolls the overlay with the field, when its text is wider than the field. */
  const alignOverlay = () => {
    if (overlay.current && input.current) overlay.current.scrollLeft = input.current.scrollLeft;
  };

  useLayoutEffect(() => {
    const at = insertedAt.current;
    if (at !== null) {
      insertedAt.current = null;
      input.current?.setSelectionRange(at, at);
    }
    alignOverlay();
  }, [value, caret]);

  /** Replaces the placeholder being typed, from its `{` to its end, with `{name}`. */
  const insert = (name: string) => {
    if (brace === undefined || caret === null) return;
    const placeholder = `{${name}}`;
    insertedAt.current = brace + placeholder.length;
    setCaret(null);
    onChange(value.slice(0, brace) + placeholder + value.slice(placeholderEnd(value, caret)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const [first] = matches;
    if (first !== undefined && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      insert(first);
    } else if (first !== undefined && e.key === 'Escape') {
      // Closes the list, not the dialog.
      e.stopPropagation();
      setCaret(null);
    }
  };

  return (
    <Box ref={setAnchor} sx={{ position: 'relative' }}>
      {/* The template drawn under the field's transparent text, its placeholders highlighted. */}
      <Box
        ref={overlay}
        aria-hidden
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          // The outlined input's own padding and line height, so each character lines up.
          p: '16.5px 14px',
          typography: 'body1',
          lineHeight: '1.4375em',
          whiteSpace: 'pre',
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {parts.map((part, i) => {
          if ('text' in part) return <span key={i}>{part.text}</span>;
          const column = rowColumn(part.name);
          if (!namesSomething(part.name, names)) {
            return (
              <Box
                key={i}
                component="span"
                sx={{ color: 'error.main', textDecoration: 'underline wavy' }}
              >
                {part.placeholder}
              </Box>
            );
          }
          if (column !== null && rowsHave(part.name, pivotRows) === false) {
            const start = starts[i] ?? 0;
            const end = start + part.placeholder.length;
            return (
              <MissingColumn
                key={i}
                placeholder={part.placeholder}
                column={column}
                caretIn={caret !== null && caret > start && caret < end}
                onPlaceCaret={() => {
                  // Into the placeholder, as a click on the field there would put it.
                  input.current?.focus();
                  input.current?.setSelectionRange(end - 1, end - 1);
                  setCaret(end - 1);
                }}
              />
            );
          }
          return (
            <Box key={i} component="span" sx={{ color: 'primary.main' }}>
              {part.placeholder}
            </Box>
          );
        })}
      </Box>
      <TextField
        fullWidth
        label="Tab title"
        value={value}
        // The text is drawn by the overlay; the caret keeps the text colour.
        sx={{ '& input': { WebkitTextFillColor: 'transparent' } }}
        error={error !== undefined}
        helperText={error ?? example}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart)}
        onBlur={() => setCaret(null)}
        onKeyDown={onKeyDown}
        inputRef={input}
        slotProps={{
          htmlInput: {
            role: 'combobox',
            'aria-autocomplete': 'list',
            'aria-expanded': matches.length > 0,
            'aria-controls': matches.length > 0 ? listId : undefined,
            'aria-activedescendant': matches.length > 0 ? optionId(0) : undefined,
            onScroll: alignOverlay,
          },
        }}
      />
      <Popper
        open={matches.length > 0}
        anchorEl={anchor}
        placement="bottom-start"
        sx={{ zIndex: 'modal' }}
      >
        <Paper elevation={6} sx={{ mt: 0.5, minWidth: 220, maxHeight: 280, overflow: 'auto' }}>
          <List dense disablePadding role="listbox" id={listId} aria-label="Placeholders">
            {matches.map((name, i) => {
              const detail = suggestionDetail(name, pivotRows);
              return (
                <ListItemButton
                  key={name}
                  id={optionId(i)}
                  role="option"
                  aria-label={`{${name}}`}
                  aria-describedby={detail === undefined ? undefined : `${optionId(i)}-detail`}
                  aria-selected={i === 0}
                  selected={i === 0}
                  // The field keeps the focus, and with it where the `{` was typed.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(name)}
                  sx={{ fontFamily: 'monospace', justifyContent: 'space-between', gap: 2 }}
                >
                  {`{${name}}`}
                  {detail !== undefined && (
                    <Typography
                      id={`${optionId(i)}-detail`}
                      variant="caption"
                      color="text.secondary"
                      noWrap
                    >
                      {detail}
                    </Typography>
                  )}
                </ListItemButton>
              );
            })}
          </List>
        </Paper>
      </Popper>
    </Box>
  );
}
