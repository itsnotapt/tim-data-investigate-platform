import type { EventComment, EventTag, SavedEvent } from '../../lib/api';
import { isSavedRow, tagEventOf, tagsDiff, tagsFromRow, tagsIntersect } from './tagSets';
import type { TagEventData, TagRow } from './tagSets';

export type TagAction = 'Ignore' | 'Override' | 'Append' | 'Remove';
export const DETERMINATION_CHOICES = ['Malicious', 'Suspicious', 'Benign'] as const;

/** Actions offered by each field's select, in legacy order. */
export const DETERMINATION_ACTIONS: readonly TagAction[] = ['Ignore', 'Override', 'Remove'];
export const COMMENT_ACTIONS: readonly TagAction[] = ['Ignore', 'Override', 'Append'];
export const TAG_ACTIONS: readonly TagAction[] = ['Ignore', 'Append', 'Remove', 'Override'];

/** Dialog state the logic works on (what the form holds). */
export interface TagDialogInput {
  determination: string | null;
  determinationAction: TagAction;
  comment: string | null;
  commentAction: TagAction;
  tags: readonly string[];
  tagAction: TagAction;
}

/** Legacy defaults: determination and comment Override, tags Ignore. */
export const defaultTagDialogInput = (): TagDialogInput => ({
  determination: null,
  determinationAction: 'Override',
  comment: null,
  commentAction: 'Override',
  tags: [],
  tagAction: 'Ignore',
});

export const MSG = {
  noAction: 'At least one action should be selected.',
  tagsEmpty: 'Tags cannot be empty.',
  removeOnly: 'Comment and tag actions must be ignored when removing determination.',
  determinationEmpty: 'Determination cannot be empty.',
  commentEmpty: 'Comment cannot be empty.',
  determinationMissing: (n: number) =>
    `Determination is missing from ${n} event(s) and cannot be ignored.`,
} as const;

/** The determination field is disabled (and not validated) for Ignore and Remove. */
export const isDeterminationDisabled = (i: TagDialogInput): boolean =>
  i.determinationAction === 'Ignore' || i.determinationAction === 'Remove';
export const isCommentDisabled = (i: TagDialogInput): boolean => i.commentAction === 'Ignore';
export const isTagsDisabled = (i: TagDialogInput): boolean => i.tagAction === 'Ignore';

export interface FieldErrors {
  determination?: string;
  comment?: string;
}

/** Per-field rules (legacy `v-form` rules). */
export function validateFields(input: TagDialogInput): FieldErrors {
  const errors: FieldErrors = {};
  if (!isDeterminationDisabled(input) && !input.determination) {
    errors.determination = MSG.determinationEmpty;
  }
  if (!isCommentDisabled(input) && !input.comment) errors.comment = MSG.commentEmpty;
  return errors;
}

/** Cross-field rules, in legacy order. */
export function validateActions(input: TagDialogInput, rows: readonly TagRow[]): string[] {
  const errors: string[] = [];
  if (
    input.commentAction === 'Ignore' &&
    input.determinationAction === 'Ignore' &&
    input.tagAction === 'Ignore'
  ) {
    errors.push(MSG.noAction);
  }
  const unsaved = rows.filter((r) => !isSavedRow(r)).length;
  if (input.determinationAction === 'Ignore' && unsaved > 0) {
    errors.push(MSG.determinationMissing(unsaved));
  }
  if (input.tagAction !== 'Ignore' && input.tags.length === 0) errors.push(MSG.tagsEmpty);
  if (
    input.determinationAction === 'Remove' &&
    (input.commentAction !== 'Ignore' || input.tagAction !== 'Ignore')
  ) {
    errors.push(MSG.removeOnly);
  }
  return errors;
}

export interface TagValidation {
  ok: boolean;
  fieldErrors: FieldErrors;
  /** Cross-field messages. Like legacy, only computed once the field rules pass. */
  errors: string[];
}

export function validateTagDialog(input: TagDialogInput, rows: readonly TagRow[]): TagValidation {
  const fieldErrors = validateFields(input);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, errors: [] };
  const errors = validateActions(input, rows);
  return { ok: errors.length === 0, fieldErrors, errors };
}

/** Lines shown under the form: "Adding X to N event(s)." / "Removing X from N event(s).". */
export function modificationPreview(
  rows: readonly TagRow[],
  tagAction: TagAction,
  selected: readonly string[],
): string[] {
  if (selected.length === 0) return [];
  const lines: string[] = [];
  const adding = () => {
    for (const tag of selected) {
      const n = rows.filter((r) => !tagsFromRow(r).includes(tag)).length;
      if (n > 0) lines.push(`Adding ${tag} to ${n} event(s).`);
    }
  };
  if (tagAction === 'Append') adding();
  else if (tagAction === 'Remove') {
    for (const tag of selected) {
      const n = rows.filter((r) => tagsFromRow(r).includes(tag)).length;
      if (n > 0) lines.push(`Removing ${tag} from ${n} event(s).`);
    }
  } else if (tagAction === 'Override') {
    adding();
    const counts = new Map<string, number>();
    for (const r of rows) {
      for (const tag of tagsFromRow(r)) {
        if (!selected.includes(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    for (const [tag, n] of counts) lines.push(`Removing ${tag} from ${n} event(s).`);
  }
  return lines;
}

/** Payloads for the three endpoints plus the rows as they look afterwards. */
export interface TagRequests {
  savedEvents: SavedEvent[];
  comments: EventComment[];
  tags: EventTag[];
  /** Same order as the input rows. */
  updatedRows: TagRow[];
}

/** The row as the event payload: the client-only `_id` is not part of the event. */
export function eventPayload(row: TagRow): Record<string, unknown> {
  const rest = { ...row };
  delete rest['_id'];
  return rest;
}

export function toSavedEvent(row: TagRow): SavedEvent {
  return {
    eventId: String(row['EventId']),
    eventTime: String(row['EventTime']),
    eventAsJson: eventPayload(row),
  };
}

function withTagEvent(row: TagRow, patch: Partial<TagEventData> | null): TagRow {
  if (patch === null) return { ...row, TagEvent: null };
  return { ...row, TagEvent: { ...tagEventOf(row), ...patch } };
}

function newComment(action: TagAction, old: string, input: string | null): string {
  switch (action) {
    case 'Ignore':
      return old;
    case 'Override':
      return input ?? '';
    case 'Append':
      return `${old} ${input ?? ''}`.trim();
    default:
      return '';
  }
}

function newDetermination(action: TagAction, old: string, input: string | null): string {
  switch (action) {
    case 'Ignore':
      return old;
    case 'Override':
      return input ?? '';
    default:
      return '';
  }
}

/**
 * Builds the requests for a validated dialog (legacy `onSaveTagEvent`):
 * - Remove determination: one deleted comment `removed`/`removed` per row, `TagEvent` cleared.
 * - otherwise saved events for unsaved rows (only when determination is Override), comments when
 *   determination or comment is not Ignore (determination lower-cased), then tag rows for
 *   Append (add missing), Remove (delete present) or Override (both, to equal the selection).
 * Rows are sent in input order; Append joins comments with a space.
 */
export function buildTagRequests(rows: readonly TagRow[], input: TagDialogInput): TagRequests {
  if (input.determinationAction === 'Remove') {
    return {
      savedEvents: [],
      comments: rows.map((r) => ({
        eventId: String(r['EventId']),
        comment: 'removed',
        determination: 'removed',
        isDeleted: true,
      })),
      tags: [],
      updatedRows: rows.map((r) => withTagEvent(r, null)),
    };
  }

  const savedEvents: SavedEvent[] = [];
  const comments: EventComment[] = [];
  const tags: EventTag[] = [];
  const saving = input.determinationAction === 'Override';
  const commenting = input.determinationAction !== 'Ignore' || input.commentAction !== 'Ignore';

  const updatedRows = rows.map((row) => {
    const eventId = String(row['EventId']);
    const patch: Partial<TagEventData> = {};
    if (saving) {
      if (!isSavedRow(row)) savedEvents.push(toSavedEvent(row));
      patch.IsSaved = true;
    }
    if (commenting) {
      const old = tagEventOf(row);
      const comment = newComment(input.commentAction, old?.Comment || '', input.comment);
      const determination = newDetermination(
        input.determinationAction,
        old?.Determination ?? '',
        input.determination,
      ).toLowerCase();
      comments.push({ eventId, comment, determination, isDeleted: false });
      patch.Comment = comment;
      patch.Determination = determination;
    }
    const existing = tagsFromRow(row);
    if (input.tagAction === 'Append') {
      const add = tagsDiff(input.tags, existing);
      tags.push(...add.map((tag) => ({ eventId, tag, isDeleted: false })));
      patch.Tags = [...existing, ...add];
    } else if (input.tagAction === 'Remove') {
      const remove = tagsIntersect(existing, input.tags);
      tags.push(...remove.map((tag) => ({ eventId, tag, isDeleted: true })));
      patch.Tags = tagsDiff(existing, input.tags);
    } else if (input.tagAction === 'Override') {
      const add = tagsDiff(input.tags, existing);
      const remove = tagsDiff(existing, input.tags);
      tags.push(
        ...add.map((tag) => ({ eventId, tag, isDeleted: false })),
        ...remove.map((tag) => ({ eventId, tag, isDeleted: true })),
      );
      patch.Tags = [...input.tags];
    }
    return withTagEvent(row, patch);
  });

  return { savedEvents, comments, tags, updatedRows };
}

/** Quick tag: save unsaved rows, then one comment per row with only the lower-cased determination. */
export function buildQuickTagRequests(rows: readonly TagRow[], determination: string): TagRequests {
  const value = determination.toLowerCase();
  return {
    savedEvents: rows.filter((r) => !isSavedRow(r)).map(toSavedEvent),
    comments: rows.map((r) => ({
      eventId: String(r['EventId']),
      determination: value,
      isDeleted: false,
    })),
    tags: [],
    updatedRows: rows.map((r) => withTagEvent(r, { Determination: value, IsSaved: true })),
  };
}

/** Rows a tagging action can target: every row needs `EventId` and `EventTime`. */
export const canTag = (rows: readonly TagRow[]): boolean =>
  rows.length > 0 && rows.every((r) => Boolean(r['EventId']) && Boolean(r['EventTime']));
