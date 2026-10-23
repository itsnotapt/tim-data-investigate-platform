import type { ColDef } from 'ag-grid-community';
import { commentsColumnDef, commentTextColumnDef, tagsColumnDef } from './annotationColumns';

export { AnnotateDialog } from './AnnotateDialog';
export type { AnnotateDialogProps } from './AnnotateDialog';
export { buildAnnotateMenu, makeAnnotateKeys } from './annotateMenu';
export type { AnnotateMenuOptions } from './annotateMenu';
export { reachOf, savedMessage } from './annotateLogic';
export type { AnnotateMode, Reach } from './annotateLogic';
export {
  COMMENT_TEXT_COLUMN_ID,
  COMMENTS_COLUMN_ID,
  commentsColumnDef,
  commentTextColumnDef,
  TAGS_COLUMN_ID,
  tagsColumnDef,
} from './annotationColumns';

/** The annotation columns of an action grid: comments (shown), Tags and Comment text (hidden). */
export const annotationColumnDefs = (): ColDef[] => [
  commentsColumnDef(),
  tagsColumnDef(),
  commentTextColumnDef(),
];
