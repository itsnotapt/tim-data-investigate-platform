import type { ColDef } from 'ag-grid-community';
import { commentsColumnDef, commentTextColumnDef, tagsColumnDef } from './annotationColumns';

export { useAnnotating } from './useAnnotating';
export type { Annotating, AnnotatingOptions } from './useAnnotating';
export { useHistoryPanel } from './useHistoryPanel';
export type { HistoryPanelOptions, HistoryPanelState } from './useHistoryPanel';
export type { AnnotateMode } from './annotateLogic';
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
