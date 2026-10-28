import type { ColDef } from 'ag-grid-community';
import {
  commentsColumnDef,
  commentTextColumnDef,
  tagsColumnDef,
  type CommentsColumnOptions,
} from './annotationColumns';

export { useAnnotating } from './useAnnotating';
export type { Annotating, AnnotatingOptions } from './useAnnotating';
export { useRowDetail } from './useRowDetail';
export { saveComment } from './commenting';
export type { CommentingDeps } from './commenting';
export type { RowDetailOptions, RowDetailState } from './useRowDetail';
export type { AnnotateMode } from './annotateLogic';
export {
  COMMENT_TEXT_COLUMN_ID,
  COMMENTS_COLUMN_ID,
  commentsColumnDef,
  commentTextColumnDef,
  TAGS_COLUMN_ID,
  tagsColumnDef,
} from './annotationColumns';
export type { CommentsColumnOptions } from './annotationColumns';

/** The annotation columns of an action grid: Comment (shown), Tags and Comment text (hidden). */
export const annotationColumnDefs = (comments: CommentsColumnOptions): ColDef[] => [
  commentsColumnDef(comments),
  tagsColumnDef(),
  commentTextColumnDef(),
];
