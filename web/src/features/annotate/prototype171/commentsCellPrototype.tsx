/**
 * PROTOTYPE (#171), throwaway: never merge into main.
 *
 * Question: what should the comments cell look like when an `id` has at most one comment per
 * analyst, and the analyst edits theirs in the cell? Three variants of the comments column on the
 * action tab's grid, switchable via `?variant=A|B|C` inside the hash: `#/<route>?variant=A`.
 *
 * - The comments are fake and in memory: seeded from each `id`, never sent to the api. Row detail,
 *   Annotate… and Comment… still show the real (append-only) comments.
 * - The editor is the same in every variant (settled in Q10): double-click, Enter or F2 opens it with
 *   your comment; Enter or clicking away saves, Shift+Enter is a new line, Esc cancels, saving it
 *   blank clears yours.
 */
import Box from '@mui/material/Box';
import type {
  ColDef,
  EditableCallbackParams,
  ICellRendererParams,
  ITooltipParams,
  SuppressKeyboardEventParams,
  ValueGetterParams,
  ValueSetterParams,
} from 'ag-grid-community';
import type { CustomCellEditorProps } from 'ag-grid-react';
import { useEffect, useRef, useState } from 'react';
import { DEV_ACCOUNT, DEV_STUB_UPN_KEY } from '../../../lib/auth/devStubAuth';

export const PROTOTYPE_VARIANTS = ['A', 'B', 'C'] as const;
export type PrototypeVariant = (typeof PROTOTYPE_VARIANTS)[number];
export const VARIANT_NAMES: Record<PrototypeVariant, string> = {
  A: 'Text first',
  B: 'My comment + Others columns',
  C: 'People chips',
};

// ---------------------------------------------------------------------------------------------
// Fake comments, one per analyst per id, in memory.

interface FakeComment {
  author: string;
  at: Date;
  text: string;
}

const me = (): string => localStorage.getItem(DEV_STUB_UPN_KEY)?.trim() || DEV_ACCOUNT.name;

const OTHERS = ['alice@example.com', 'bob@example.com', 'chen.wei@example.com'];
const SAMPLE = [
  'Benign: scheduled task from the patching run.',
  'Same host as the 10-02 incident, worth a look.',
  'Escalated to IR, ticket INC-2231.',
  'False positive; the service account rotates its key nightly.',
  'Checked with the owner.\nThey confirmed the sign-in from the VPN exit node.',
];

const hash = (s: string): number => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Each scenario a cell can be in, picked from the id so a reload shows the same cells. */
function seed(id: string): Map<string, FakeComment> {
  const h = hash(id);
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 20, 9, 0) + minutes * 60_000);
  const text = (n: number) => SAMPLE[(h + n) % SAMPLE.length] ?? '';
  const comments = new Map<string, FakeComment>();
  const add = (author: string, n: number) =>
    comments.set(author, { author, at: at(h % 500 + n * 37), text: text(n) });
  switch (h % 6) {
    case 0: // none
      break;
    case 1: // yours only
      add(me(), 0);
      break;
    case 2: // one other
      add(OTHERS[h % 3] ?? '', 1);
      break;
    case 3: // yours and two others
      add(OTHERS[0] ?? '', 1);
      add(me(), 2);
      add(OTHERS[2] ?? '', 3);
      break;
    case 4: // three others, none yours
      OTHERS.forEach((o, i) => add(o, i + 1));
      break;
    default: // yours, long and multi-line
      add(me(), 4);
      add(OTHERS[1] ?? '', 0);
  }
  return comments;
}

const store = new Map<string, Map<string, FakeComment>>();

function commentsOf(id: string): Map<string, FakeComment> {
  let found = store.get(id);
  if (!found) {
    found = seed(id);
    store.set(id, found);
  }
  return found;
}

const mine = (id: string): FakeComment | undefined => commentsOf(id).get(me());
/** Everyone else's comments, newest first. */
const others = (id: string): FakeComment[] =>
  [...commentsOf(id).values()]
    .filter((c) => c.author !== me())
    .sort((a, b) => b.at.getTime() - a.at.getTime());

/** Replaces your comment on `id`; blank clears it. */
function setMine(id: string, text: string): void {
  const comments = commentsOf(id);
  const trimmed = text.trim();
  if (trimmed === '') comments.delete(me());
  else comments.set(me(), { author: me(), at: new Date(), text: trimmed });
  console.info('[prototype #171] your comment on', id, '→', trimmed === '' ? '(cleared)' : trimmed);
}

// ---------------------------------------------------------------------------------------------
// Shared bits.

const idOf = (data: unknown): string | null => {
  const id = (data as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' && id !== '' ? id : null;
};

const shortName = (upn: string) => upn.split('@')[0] ?? upn;
const when = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

/** Every current comment, yours first, one per line. */
function allCommentsTooltip(p: ITooltipParams): string | undefined {
  const id = idOf(p.data);
  if (id === null) return "This row has no id, so it can't have comments.";
  const lines = [mine(id), ...others(id)]
    .filter((c): c is FakeComment => c !== undefined)
    .map((c) => `${c.author === me() ? 'You' : c.author} · ${when(c.at)}\n${c.text}`);
  return lines.length > 0 ? lines.join('\n\n') : 'No comments. Double-click to add yours.';
}

/** The popup editor: your comment. Enter saves, Shift+Enter is a new line; clicking away saves (grid option). */
function MyCommentEditor({ data, onValueChange, stopEditing }: CustomCellEditorProps) {
  const id = idOf(data) ?? '';
  const [text, setText] = useState(() => mine(id)?.text ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  // After AG Grid has placed the popup and moved focus to it.
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 50);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => onValueChange(text), [text, onValueChange]);
  const theirs = others(id);
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
      <Box sx={{ fontSize: 11, color: 'text.secondary', mb: 0.5 }}>
        {`Your comment on ${id}`}
      </Box>
      <textarea
        ref={ref}
        value={text}
        rows={4}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (!e.shiftKey) {
            stopEditing();
            return;
          }
          // Shift+Enter: a new line at the cursor.
          const el = e.currentTarget;
          const at = el.selectionStart;
          const next = `${text.slice(0, at)}\n${text.slice(el.selectionEnd)}`;
          setText(next);
          requestAnimationFrame(() => el.setSelectionRange(at + 1, at + 1));
        }}
        style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13 }}
      />
      <Box sx={{ fontSize: 11, color: 'text.secondary', display: 'flex', gap: 1 }}>
        <span>Enter or click away saves · Shift+Enter new line · Esc cancels · blank clears yours</span>
      </Box>
      {theirs.length > 0 && (
        <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider', fontSize: 12 }}>
          {theirs.map((c) => (
            <Box key={c.author} sx={{ color: 'text.secondary', mb: 0.5, whiteSpace: 'pre-wrap' }}>
              <b>{shortName(c.author)}</b>
              {`: ${c.text}`}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** Editing your comment, shared by every variant's editable column. */
const editing: Partial<ColDef> = {
  editable: (p: EditableCallbackParams) => idOf(p.data) !== null,
  cellEditor: MyCommentEditor,
  cellEditorPopup: true,
  cellEditorPopupPosition: 'under',
  valueSetter: (p: ValueSetterParams) => {
    const id = idOf(p.data);
    if (id === null) return false;
    setMine(id, typeof p.newValue === 'string' ? p.newValue : '');
    // Every row of the id, not just the edited one.
    setTimeout(() => p.api.refreshCells({ force: true }));
    return true;
  },
  // Keep T, C, D and the label digits working on this cell: no typing-to-start-editing. While
  // editing, the editor handles Enter (save) and Shift+Enter (new line) itself.
  suppressKeyboardEvent: (p: SuppressKeyboardEventParams) => {
    const e = p.event;
    if (p.editing) return e.key === 'Enter';
    return e.key.length === 1 && !e.ctrlKey && !e.metaKey;
  },
};

const ellipsis = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

// ---------------------------------------------------------------------------------------------
// A: one column. Your text, else the latest other's dimmed as "author: text", plus "+N".

function TextFirstCell({ data }: ICellRendererParams) {
  const id = idOf(data);
  if (id === null) return null;
  const yours = mine(id);
  const theirs = others(id);
  const shown = yours ?? theirs[0];
  if (!shown) return <Box sx={{ color: 'text.disabled', fontSize: 12 }} className="proto-hint" />;
  const more = theirs.length - (yours ? 0 : 1);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <Box
        sx={{
          ...ellipsis,
          flex: 1,
          color: yours ? 'text.primary' : 'text.secondary',
          fontStyle: yours ? 'normal' : 'italic',
        }}
      >
        {yours ? yours.text.replace(/\n/g, ' ⏎ ') : `${shortName(shown.author)}: ${shown.text}`}
      </Box>
      {more > 0 && (
        <Box
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

const variantA = (): ColDef[] => [
  {
    colId: 'proto:comments:A',
    headerName: 'Comment',
    width: 280,
    filter: 'agTextColumnFilter',
    valueGetter: (p: ValueGetterParams) => {
      const id = idOf(p.data);
      if (id === null) return null;
      const shown = mine(id) ?? others(id)[0];
      return shown?.text ?? null;
    },
    cellRenderer: TextFirstCell,
    tooltip: allCommentsTooltip,
    ...editing,
  },
];

// ---------------------------------------------------------------------------------------------
// B: two columns. "My comment", the editable one, and "Others": a count with the latest's text.

function MyCommentCell({ data }: ICellRendererParams) {
  const id = idOf(data);
  if (id === null) return null;
  const yours = mine(id);
  return yours ? (
    <Box sx={ellipsis}>{yours.text.replace(/\n/g, ' ⏎ ')}</Box>
  ) : (
    <Box sx={{ color: 'text.disabled', fontSize: 12 }}>—</Box>
  );
}

function OthersCell({ data }: ICellRendererParams) {
  const id = idOf(data);
  if (id === null) return null;
  const theirs = others(id);
  if (theirs.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', minWidth: 0 }}>
      <Box sx={{ fontWeight: 600, flexShrink: 0 }}>{`💬 ${theirs.length}`}</Box>
      <Box sx={{ ...ellipsis, color: 'text.secondary', fontStyle: 'italic' }}>
        {`${shortName(theirs[0]?.author ?? '')}: ${theirs[0]?.text ?? ''}`}
      </Box>
    </Box>
  );
}

const variantB = (): ColDef[] => [
  {
    colId: 'proto:comments:B',
    headerName: 'My comment',
    width: 220,
    filter: 'agTextColumnFilter',
    valueGetter: (p: ValueGetterParams) => {
      const id = idOf(p.data);
      return id === null ? null : (mine(id)?.text ?? null);
    },
    cellRenderer: MyCommentCell,
    tooltip: (p: ITooltipParams) =>
      idOf(p.data) === null
        ? "This row has no id, so it can't have comments."
        : 'Double-click to edit your comment',
    ...editing,
  },
  {
    colId: 'proto:othersComments',
    headerName: 'Others',
    width: 200,
    filter: 'agTextColumnFilter',
    valueGetter: (p: ValueGetterParams) => {
      const id = idOf(p.data);
      return id === null ? null : others(id).map((c) => `${c.author}: ${c.text}`).join('\n') || null;
    },
    cellRenderer: OthersCell,
    tooltip: allCommentsTooltip,
  },
];

// ---------------------------------------------------------------------------------------------
// C: one narrow column of people. A chip per analyst with a comment, yours first and filled; a
// dashed "+" chip when you have none. The text is only in the tooltip and the editor.

const initials = (upn: string) =>
  shortName(upn)
    .split(/[._-]/)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);

function PeopleCell({ data }: ICellRendererParams) {
  const id = idOf(data);
  if (id === null) return null;
  const yours = mine(id);
  const theirs = others(id);
  const chip = {
    width: 20,
    height: 20,
    borderRadius: '50%',
    fontSize: 10,
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  } as const;
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', height: '100%' }}>
      {yours ? (
        <Box sx={{ ...chip, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
          {initials(yours.author)}
        </Box>
      ) : (
        <Box
          sx={{ ...chip, border: '1px dashed', borderColor: 'text.disabled', color: 'text.disabled' }}
        >
          +
        </Box>
      )}
      {theirs.map((c) => (
        <Box
          key={c.author}
          sx={{ ...chip, bgcolor: 'action.selected', color: 'text.secondary' }}
        >
          {initials(c.author)}
        </Box>
      ))}
    </Box>
  );
}

const variantC = (): ColDef[] => [
  {
    colId: 'proto:comments:C',
    headerName: 'Comments',
    width: 130,
    filter: 'agTextColumnFilter',
    valueGetter: (p: ValueGetterParams) => {
      const id = idOf(p.data);
      return id === null ? null : [mine(id), ...others(id)].filter(Boolean).length;
    },
    cellRenderer: PeopleCell,
    tooltip: allCommentsTooltip,
    ...editing,
  },
];

/** The comments column(s) of `variant`, in place of the real comments column. */
export function prototypeCommentsColumnDefs(variant: PrototypeVariant): ColDef[] {
  if (variant === 'B') return variantB();
  if (variant === 'C') return variantC();
  return variantA();
}

export const isPrototypeVariant = (v: string | null): v is PrototypeVariant =>
  (PROTOTYPE_VARIANTS as readonly string[]).includes(v ?? '');
