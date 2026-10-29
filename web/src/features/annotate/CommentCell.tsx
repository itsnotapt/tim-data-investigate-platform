import Box from '@mui/material/Box';
import type { CustomCellEditorProps } from 'ag-grid-react';
import { useEffect, useId, useRef, useState } from 'react';
import { commentsOf, idOf, shortName, shownComment, type EditedComment } from './comments';

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

export interface CommentCellProps {
  data?: unknown;
  /** The signed-in analyst's UPN. */
  analyst: string | null;
}

/**
 * A Comment cell: your comment, else the latest other one dimmed and italic as "author: text", a
 * line break as ⏎, and +N for the others' comments not shown.
 */
export function CommentCell({ data, analyst }: CommentCellProps) {
  const text = shownComment(data, analyst);
  if (text === null) return null;
  const { mine, others } = commentsOf(data, analyst);
  const more = others.length - (mine ? 0 : 1);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <Box
        component="span"
        sx={{
          ...ellipsis,
          flex: 1,
          color: mine ? 'text.primary' : 'text.secondary',
          fontStyle: mine ? 'normal' : 'italic',
        }}
      >
        {text.replace(/\n/g, ' ⏎ ')}
      </Box>
      {more > 0 && (
        <Box
          component="span"
          sx={{
            fontSize: 11,
            px: 0.75,
            borderRadius: 8,
            bgcolor: 'action.selected',
            color: 'text.secondary',
            flexShrink: 0,
          }}
        >
          {`+${more}`}
        </Box>
      )}
    </Box>
  );
}

export type CommentEditorProps = Pick<
  CustomCellEditorProps,
  'data' | 'onValueChange' | 'stopEditing'
> & {
  /** The signed-in analyst's UPN: whose comment the editor edits. */
  analyst: string | null;
};

/**
 * The Comment cell's popup editor: your comment, never another's, with the others' below it,
 * read-only. Enter saves and Shift+Enter is a new line; the grid saves on clicking away and cancels
 * on Esc.
 */
export function CommentEditor({ data, onValueChange, stopEditing, analyst }: CommentEditorProps) {
  const id = idOf(data) ?? '';
  const { mine, others } = commentsOf(data, analyst);
  const [text, setText] = useState(mine?.text ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxId = useId();
  // Once the grid has placed the popup and moved the focus to it.
  useEffect(() => {
    const timer = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => onValueChange({ edited: text } satisfies EditedComment), [text, onValueChange]);
  return (
    <Box
      sx={{
        width: 360,
        p: 1,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'primary.main',
        boxShadow: 4,
        borderRadius: 1,
      }}
    >
      <Box component="label" htmlFor={boxId} sx={{ fontSize: 11, color: 'text.secondary' }}>
        {`Your comment on ${id}`}
      </Box>
      <textarea
        id={boxId}
        ref={ref}
        value={text}
        rows={4}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey) return;
          e.preventDefault();
          stopEditing();
        }}
        style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13 }}
      />
      <Box sx={{ fontSize: 11, color: 'text.secondary' }}>
        Enter or clicking away saves · Shift+Enter new line · Esc cancels · blank clears yours
      </Box>
      {others.length > 0 && (
        <Box
          component="ul"
          aria-label="Other comments"
          sx={{
            listStyle: 'none',
            m: 0,
            mt: 1,
            p: 0,
            pt: 1,
            borderTop: 1,
            borderColor: 'divider',
            fontSize: 12,
          }}
        >
          {others.map((c) => (
            <Box
              component="li"
              key={c.author}
              sx={{ color: 'text.secondary', mb: 0.5, whiteSpace: 'pre-wrap' }}
            >
              <b>{shortName(c.author)}</b>
              {`: ${c.text}`}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
