import type { CallOptions } from '../../lib/api';
import { buildQuickTagRequests } from './tagDialogLogic';
import type { TagRow } from './tagSets';
import { submitTagRequests, TagSubmitError } from './submitTags';

export const QUICK_MESSAGES = {
  saving: 'Quick saving events...',
  success: 'Tag events successfully saved.',
  eventsFailed: (m: string) => `Saving events failed: ${m}`,
  commentsFailed: (m: string) => `Saving comments failed: ${m}`,
} as const;

export type QuickTagResult =
  { ok: true; rows: TagRow[] } | { ok: false; error: TagSubmitError | Error };

/**
 * Quick tag (legacy "Quick - Malicious/Suspicious/Benign"): saves the unsaved rows, then creates
 * a comment with the lower-cased determination for every row. Never rejects; the snackbar texts
 * are the legacy ones. On success `rows` are the updated rows (determination set, `IsSaved`).
 */
export async function quickTag(
  rows: readonly TagRow[],
  determination: string,
  notify: (message: string) => void,
  opts: CallOptions = {},
): Promise<QuickTagResult> {
  notify(QUICK_MESSAGES.saving);
  const requests = buildQuickTagRequests(rows, determination);
  try {
    await submitTagRequests(requests, opts);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (error instanceof TagSubmitError) {
      notify(
        error.stage === 'events'
          ? QUICK_MESSAGES.eventsFailed(error.message)
          : QUICK_MESSAGES.commentsFailed(error.message),
      );
    } else notify(QUICK_MESSAGES.commentsFailed(error.message));
    return { ok: false, error };
  }
  notify(QUICK_MESSAGES.success);
  return { ok: true, rows: requests.updatedRows };
}
