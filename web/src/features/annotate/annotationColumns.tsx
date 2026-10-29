import type { ColDef } from 'ag-grid-community';
import { formatUtcDateTime } from '../../lib/utcFormat';
import { CommentCell, CommentEditor } from './CommentCell';
import { annotationsOf, commentsOf, idOf, isEditedComment, shownComment } from './comments';

export const TAGS_COLUMN_ID = 'tim:tags';
export const COMMENTS_COLUMN_ID = 'tim:comments';
export const COMMENT_TEXT_COLUMN_ID = 'tim:commentText';

const NO_TAGS = '(no tags)';

/**
 * The hidden Tags column: the row's tags. The set filter lists each tag once, plus "(no tags)";
 * grouping groups by the whole set.
 */
export function tagsColumnDef(): ColDef {
  return {
    colId: TAGS_COLUMN_ID,
    headerName: 'Tags',
    initialHide: true,
    enableRowGroup: true,
    filter: 'agSetColumnFilter',
    filterParams: {
      valueFormatter: (p: { value: unknown }) => (p.value as string | null) ?? NO_TAGS,
    },
    valueGetter: (p) => annotationsOf(p.data)?.tags ?? [],
    valueFormatter: (p) => ((p.value as string[] | null) ?? []).join(', '),
    keyCreator: (p) => {
      const tags = p.value as string[] | string | null;
      if (!Array.isArray(tags)) return tags ?? NO_TAGS;
      return tags.length > 0 ? tags.join(', ') : NO_TAGS;
    },
  };
}

/** The hidden Comment text column: the text of every comment, for its text filter. */
export function commentTextColumnDef(): ColDef {
  return {
    colId: COMMENT_TEXT_COLUMN_ID,
    headerName: 'Comment text',
    initialHide: true,
    filter: 'agTextColumnFilter',
    valueGetter: (p) => {
      const comments = annotationsOf(p.data)?.comments ?? [];
      return comments.length > 0 ? comments.map((c) => c.text).join('\n') : null;
    },
  };
}

export interface CommentsColumnOptions {
  /** The signed-in analyst's UPN: whose comment the cell edits. */
  analyst: string | null;
  /** Saves `text` as the analyst's comment on `id`; an empty text clears it. */
  saveComment: (id: string, text: string) => void;
}

/**
 * The Comment column: your comment, else the latest other one, text-filtered on what it shows, with
 * every current comment in the tooltip. Double-click, Enter or F2 edits your comment on the row's
 * `id` in a popup; typing a letter doesn't, so the grid's keys keep working.
 */
export function commentsColumnDef({ analyst, saveComment }: CommentsColumnOptions): ColDef {
  return {
    colId: COMMENTS_COLUMN_ID,
    headerName: 'Comment',
    width: 280,
    filter: 'agTextColumnFilter',
    valueGetter: (p) => (idOf(p.data) === null ? null : shownComment(p.data, analyst)),
    // The cell shows more than its value: the others' comments, in +N and the tooltip.
    equals: () => false,
    cellRenderer: CommentCell,
    cellRendererParams: { analyst },
    tooltip: (p: { data?: unknown }) => {
      if (idOf(p.data) === null) return "This row has no id, so it can't have comments.";
      const { mine, others } = commentsOf(p.data, analyst);
      const all = mine ? [mine, ...others.toReversed()] : others.toReversed();
      if (all.length === 0) return undefined;
      return all.map((c) => `${c.author} · ${formatUtcDateTime(c.at)}\n${c.text}`).join('\n\n');
    },
    editable: (p) => idOf(p.data) !== null,
    cellEditor: CommentEditor,
    cellEditorParams: { analyst },
    cellEditorPopup: true,
    cellEditorPopupPosition: 'under',
    // The change goes to the api; the row updates when the annotation store has it.
    valueSetter: (p) => {
      const id = idOf(p.data);
      if (id === null || !isEditedComment(p.newValue)) return false;
      const text = p.newValue.edited.trim();
      if (text !== (commentsOf(p.data, analyst).mine?.text ?? '')) saveComment(id, text);
      return false;
    },
    // A letter doesn't start an edit, so T, C, D and the label digits keep working on the cell;
    // in the editor, Shift+Enter is a new line rather than the grid's end of the edit.
    suppressKeyboardEvent: ({ editing, event }) =>
      editing
        ? event.key === 'Enter' && event.shiftKey
        : event.key.length === 1 && !event.ctrlKey && !event.metaKey,
  };
}
