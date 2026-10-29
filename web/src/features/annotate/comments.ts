import type { Annotations, Comment } from '../../lib/api';

export const annotationsOf = (data: unknown): Annotations | undefined =>
  (data as { annotations?: Annotations } | null | undefined)?.annotations;

/** The row's `id`, or `null` when it has none. */
export const idOf = (data: unknown): string | null => {
  const id = (data as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' && id !== '' ? id : null;
};

/** A UPN's part before the `@`. */
export const shortName = (upn: string): string => upn.split('@')[0] ?? upn;

/** The row's current comments: `analyst`'s, if any, and the others', newest first. */
export function commentsOf(
  data: unknown,
  analyst: string | null,
): { mine: Comment | undefined; others: Comment[] } {
  const comments = annotationsOf(data)?.comments ?? [];
  return {
    mine: comments.find((c) => c.author === analyst),
    others: comments.filter((c) => c.author !== analyst).reverse(),
  };
}

/** The text a Comment cell shows: your comment, else the latest other one as "author: text". */
export function shownComment(data: unknown, analyst: string | null): string | null {
  const { mine, others } = commentsOf(data, analyst);
  const [latest] = others;
  if (mine) return mine.text;
  return latest ? `${shortName(latest.author)}: ${latest.text}` : null;
}

/** The Comment editor's value: only an edit in the editor saves a comment, never a paste or Delete. */
export interface EditedComment {
  readonly edited: string;
}

export const isEditedComment = (value: unknown): value is EditedComment =>
  typeof (value as Partial<EditedComment> | null | undefined)?.edited === 'string';
