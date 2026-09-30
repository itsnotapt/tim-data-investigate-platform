import { useCallback, useContext } from 'react';
import type { CellEditRequestEvent } from 'ag-grid-community';
import { commentEvents } from '../../lib/api';
import type { CallOptions } from '../../lib/api';
import { NotifyContext } from '../../components/notifyContext';
import { COMMENT_COLUMN, isCommentEditable, scalarText } from '../grid/columns';
import type { GridRowWithId } from '../grid/columns';
import { applyRowUpdates } from '../grid/rowUpdates';
import { tagEventOf } from './tagSets';
import { tagErrorMessage } from './submitTags';

export const COMMENT_MESSAGES = {
  saving: 'Quick saving comment...',
  success: 'Comment successfully quick saved.', // BUG-42: legacy text was wrong in places
  failed: (m: string) => `Saving comments failed: ${m}`,
} as const;

/** Structural slice of `CellEditRequestEvent` (tests fake it). */
export interface CommentEditEvent {
  colDef?: { field?: string };
  column?: { getColId(): string };
  data?: GridRowWithId;
  oldValue?: unknown;
  newValue?: unknown;
  api: {
    applyTransaction(tx: { update: GridRowWithId[] }): unknown;
    refreshCells?(params?: { force?: boolean }): void;
  };
}

export interface CommentEditOptions {
  /** Tab uuid, for the stored rows. */
  uuid: string;
  columnId?: string | null;
  notify: (message: string) => void;
  call?: CallOptions;
}

/**
 * Handles a cell edit request (the grid runs with `readOnlyEdit`, so the cell value is only
 * changed by us): for the comment column of a saved row with a determination, posts one comment
 * `{eventId, determination, comment, isDeleted: false}`, then updates the row (grid + stored rows).
 * On failure the row is left as it was (the cell shows the old value again) and an error snackbar
 * is shown. Never rejects. Returns true when the comment was saved.
 */
export async function commentEdit(
  event: CommentEditEvent,
  opts: CommentEditOptions,
): Promise<boolean> {
  const colId = event.column?.getColId() ?? event.colDef?.field;
  if (colId !== COMMENT_COLUMN) return false;
  const data = event.data;
  if (!data || !isCommentEditable(data)) return false;
  if (event.newValue === event.oldValue) return false;

  const tag = tagEventOf(data);
  const comment = scalarText(event.newValue);
  opts.notify(COMMENT_MESSAGES.saving);
  try {
    await commentEvents(
      [
        {
          eventId: String(data['EventId']),
          determination: String(tag?.Determination),
          comment,
          isDeleted: false,
        },
      ],
      opts.call,
    );
  } catch (err) {
    opts.notify(COMMENT_MESSAGES.failed(tagErrorMessage(err)));
    event.api.refreshCells?.({ force: true });
    return false;
  }
  const row = { ...data, TagEvent: { ...tag, Comment: comment } } as GridRowWithId;
  await applyRowUpdates(event.api, opts.uuid, [row], opts.columnId);
  opts.notify(COMMENT_MESSAGES.success);
  return true;
}

/** `onCellEditRequest` handler for a tab's grid (comment edit, P4-24). */
export function useCommentEdit(
  uuid: string,
  columnId?: string | null,
  call?: CallOptions,
): (event: CellEditRequestEvent<GridRowWithId>) => void {
  const notifyCtx = useContext(NotifyContext);
  return useCallback(
    (event) => {
      void commentEdit(event, { uuid, columnId, call, notify: (m) => notifyCtx?.(m) });
    },
    [uuid, columnId, call, notifyCtx],
  );
}
