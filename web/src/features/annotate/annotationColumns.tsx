import type { ColDef } from 'ag-grid-community';
import type { Annotations } from '../../lib/api';
import { CommentsCell } from './CommentsCell';

export const TAGS_COLUMN_ID = 'tim:tags';
export const COMMENTS_COLUMN_ID = 'tim:comments';
export const COMMENT_TEXT_COLUMN_ID = 'tim:commentText';

const NO_TAGS = '(no tags)';

const annotationsOf = (data: unknown): Annotations | undefined =>
  (data as { annotations?: Annotations } | null | undefined)?.annotations;

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

/** The comments column: how many comments the row's `id` has, with the latest in the tooltip. */
export function commentsColumnDef(): ColDef {
  return {
    colId: COMMENTS_COLUMN_ID,
    headerName: 'Comments',
    headerTooltip: 'Comments',
    width: 90,
    filter: 'agNumberColumnFilter',
    valueGetter: (p) => annotationsOf(p.data)?.comments?.length ?? 0,
    cellRenderer: CommentsCell,
    tooltip: (p) => {
      const latest = annotationsOf(p.data)?.comments?.at(-1);
      return latest ? `${latest.author}: ${latest.text}` : undefined;
    },
  };
}
