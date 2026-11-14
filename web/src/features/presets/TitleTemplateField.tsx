import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import TextField from '@mui/material/TextField';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { namesSomething, templateParts } from '../action-tab/titleTemplate';

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

/**
 * The Tab title of the Save preset dialog: a title template, its placeholders highlighted, the
 * unknown ones as errors. Typing `{` suggests placeholders, filtered by what follows it: Enter or
 * Tab inserts the first, Escape closes the list.
 */
export function TitleTemplateField({
  value,
  onChange,
  names,
  suggestions,
  example,
  error,
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
        {templateParts(value).map((part, i) =>
          'text' in part ? (
            <span key={i}>{part.text}</span>
          ) : namesSomething(part.name, names) ? (
            <Box key={i} component="span" sx={{ color: 'primary.main' }}>
              {part.placeholder}
            </Box>
          ) : (
            <Box
              key={i}
              component="span"
              sx={{ color: 'error.main', textDecoration: 'underline wavy' }}
            >
              {part.placeholder}
            </Box>
          ),
        )}
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
            {matches.map((name, i) => (
              <ListItemButton
                key={name}
                id={optionId(i)}
                role="option"
                aria-selected={i === 0}
                selected={i === 0}
                // The field keeps the focus, and with it where the `{` was typed.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(name)}
                sx={{ fontFamily: 'monospace' }}
              >
                {`{${name}}`}
              </ListItemButton>
            ))}
          </List>
        </Paper>
      </Popper>
    </Box>
  );
}
