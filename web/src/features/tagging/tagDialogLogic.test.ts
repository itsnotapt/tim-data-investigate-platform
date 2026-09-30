import { describe, expect, it } from 'vitest';
import {
  buildQuickTagRequests,
  buildTagRequests,
  canTag,
  defaultTagDialogInput,
  modificationPreview,
  MSG,
  validateTagDialog,
  type TagDialogInput,
} from './tagDialogLogic';
import { existingTagCounts, tagOptions, tagsDiff, tagsFromRow, tagsIntersect } from './tagSets';

const unsaved = { EventId: 'e1', EventTime: '2024-01-01T00:00:00Z', Name: 'one', _id: 'e1' };
const saved = {
  EventId: 'e2',
  EventTime: '2024-01-02T00:00:00Z',
  TagEvent: { IsSaved: true, Determination: 'benign', Comment: 'old', Tags: ['a', 'b'] },
};
const saved2 = {
  EventId: 'e3',
  EventTime: '2024-01-03T00:00:00Z',
  TagEvent: { IsSaved: true, Determination: 'malicious', Tags: ['b', 'c'] },
};

const input = (over: Partial<TagDialogInput> = {}): TagDialogInput => ({
  ...defaultTagDialogInput(),
  determination: 'Malicious',
  comment: 'hello',
  ...over,
});

describe('tagSets', () => {
  it('reads tags defensively and does set arithmetic', () => {
    expect(tagsFromRow({})).toEqual([]);
    expect(tagsFromRow({ TagEvent: { Tags: 'x' } })).toEqual([]);
    expect(tagsFromRow(saved)).toEqual(['a', 'b']);
    expect(tagsDiff(['a', 'b', 'a', 'c'], ['b'])).toEqual(['a', 'c']);
    expect(tagsIntersect(['a', 'b'], ['c', 'b', 'a'])).toEqual(['b', 'a']);
    expect(existingTagCounts([saved, saved2, unsaved]).get('b')).toBe(2);
    expect(tagOptions([saved], ['z'], ['r'], false)).toEqual(['z', 'a', 'b', 'r']);
    expect(tagOptions([saved], ['z'], ['r'], true)).toEqual(['z', 'a', 'b']);
  });
});

describe('validateTagDialog', () => {
  it('passes the defaults with determination and comment', () => {
    expect(validateTagDialog(input(), [unsaved])).toEqual({
      ok: true,
      fieldErrors: {},
      errors: [],
    });
  });
  it('field errors: determination and comment cannot be empty, and stop cross-field checks', () => {
    const r = validateTagDialog(input({ determination: null, comment: '' }), [unsaved]);
    expect(r.ok).toBe(false);
    expect(r.fieldErrors).toEqual({
      determination: MSG.determinationEmpty,
      comment: MSG.commentEmpty,
    });
    expect(r.errors).toEqual([]);
    expect(MSG.determinationEmpty).toBe('Determination cannot be empty.');
    expect(MSG.commentEmpty).toBe('Comment cannot be empty.');
  });
  it('ignored or removed fields are not validated', () => {
    const r = validateTagDialog(
      input({
        determination: null,
        determinationAction: 'Ignore',
        commentAction: 'Ignore',
        tagAction: 'Append',
        tags: ['t'],
      }),
      [saved],
    );
    expect(r.ok).toBe(true);
  });
  it('At least one action should be selected.', () => {
    const r = validateTagDialog(
      input({ determinationAction: 'Ignore', commentAction: 'Ignore', tagAction: 'Ignore' }),
      [saved],
    );
    expect(r.errors).toEqual(['At least one action should be selected.']);
  });
  it('Determination is missing from N event(s) and cannot be ignored.', () => {
    const r = validateTagDialog(input({ determinationAction: 'Ignore' }), [
      unsaved,
      saved,
      unsaved,
    ]);
    expect(r.errors).toEqual(['Determination is missing from 2 event(s) and cannot be ignored.']);
  });
  it('Tags cannot be empty.', () => {
    for (const tagAction of ['Append', 'Remove', 'Override'] as const) {
      expect(validateTagDialog(input({ tagAction }), [unsaved]).errors).toEqual([
        'Tags cannot be empty.',
      ]);
    }
  });
  it('Comment and tag actions must be ignored when removing determination.', () => {
    const msg = 'Comment and tag actions must be ignored when removing determination.';
    expect(
      validateTagDialog(input({ determinationAction: 'Remove', commentAction: 'Override' }), [
        saved,
      ]).errors,
    ).toEqual([msg]);
    expect(
      validateTagDialog(
        input({
          determinationAction: 'Remove',
          commentAction: 'Ignore',
          tagAction: 'Append',
          tags: ['x'],
        }),
        [saved],
      ).errors,
    ).toEqual([msg]);
    expect(
      validateTagDialog(input({ determinationAction: 'Remove', commentAction: 'Ignore' }), [saved])
        .ok,
    ).toBe(true);
  });
  it('collects several cross-field messages in legacy order', () => {
    const r = validateTagDialog(
      input({ determinationAction: 'Ignore', commentAction: 'Ignore', tagAction: 'Append' }),
      [unsaved],
    );
    expect(r.errors).toEqual([
      'Determination is missing from 1 event(s) and cannot be ignored.',
      'Tags cannot be empty.',
    ]);
  });
});

describe('modificationPreview', () => {
  const rows = [saved, saved2, unsaved];
  it('is empty without tags or for Ignore', () => {
    expect(modificationPreview(rows, 'Append', [])).toEqual([]);
    expect(modificationPreview(rows, 'Ignore', ['a'])).toEqual([]);
  });
  it('Append lists additions only for rows missing the tag', () => {
    expect(modificationPreview(rows, 'Append', ['a', 'b', 'new'])).toEqual([
      'Adding a to 2 event(s).',
      'Adding b to 1 event(s).',
      'Adding new to 3 event(s).',
    ]);
  });
  it('Remove lists removals for rows that have the tag', () => {
    expect(modificationPreview(rows, 'Remove', ['b', 'zzz'])).toEqual([
      'Removing b from 2 event(s).',
    ]);
  });
  it('Override adds then removes tags outside the selection', () => {
    expect(modificationPreview(rows, 'Override', ['a'])).toEqual([
      'Adding a to 2 event(s).',
      'Removing b from 2 event(s).',
      'Removing c from 1 event(s).',
    ]);
  });
});

describe('buildTagRequests', () => {
  it('Override determination + comment saves unsaved events, lower-cases, marks rows saved', () => {
    const r = buildTagRequests([unsaved, saved], input());
    expect(r.savedEvents).toEqual([
      {
        eventId: 'e1',
        eventTime: '2024-01-01T00:00:00Z',
        eventAsJson: { EventId: 'e1', EventTime: '2024-01-01T00:00:00Z', Name: 'one' },
      },
    ]);
    expect(r.comments).toEqual([
      { eventId: 'e1', comment: 'hello', determination: 'malicious', isDeleted: false },
      { eventId: 'e2', comment: 'hello', determination: 'malicious', isDeleted: false },
    ]);
    expect(r.tags).toEqual([]);
    expect(r.updatedRows[0]?.['TagEvent']).toEqual({
      IsSaved: true,
      Comment: 'hello',
      Determination: 'malicious',
    });
    expect(r.updatedRows[1]?.['TagEvent']).toMatchObject({
      Tags: ['a', 'b'],
      Determination: 'malicious',
    });
  });
  it('Append comment joins with a space; Ignore determination keeps the old one', () => {
    const r = buildTagRequests(
      [saved, saved2],
      input({ determinationAction: 'Ignore', commentAction: 'Append' }),
    );
    expect(r.savedEvents).toEqual([]);
    expect(r.comments).toEqual([
      { eventId: 'e2', comment: 'old hello', determination: 'benign', isDeleted: false },
      { eventId: 'e3', comment: 'hello', determination: 'malicious', isDeleted: false },
    ]);
  });
  it('Ignore comment keeps the old comment while overriding determination', () => {
    const r = buildTagRequests(
      [saved],
      input({ commentAction: 'Ignore', determination: 'Suspicious' }),
    );
    expect(r.comments).toEqual([
      { eventId: 'e2', comment: 'old', determination: 'suspicious', isDeleted: false },
    ]);
  });
  it('tags only: no saved events and no comments', () => {
    const r = buildTagRequests(
      [saved],
      input({
        determinationAction: 'Ignore',
        commentAction: 'Ignore',
        tagAction: 'Append',
        tags: ['b', 'n'],
      }),
    );
    expect(r.savedEvents).toEqual([]);
    expect(r.comments).toEqual([]);
    expect(r.tags).toEqual([{ eventId: 'e2', tag: 'n', isDeleted: false }]);
    expect(r.updatedRows[0]?.['TagEvent']).toMatchObject({ Tags: ['a', 'b', 'n'] });
  });
  it('Remove tags deletes only tags present', () => {
    const r = buildTagRequests(
      [saved, saved2],
      input({
        determinationAction: 'Ignore',
        commentAction: 'Ignore',
        tagAction: 'Remove',
        tags: ['b', 'x'],
      }),
    );
    expect(r.tags).toEqual([
      { eventId: 'e2', tag: 'b', isDeleted: true },
      { eventId: 'e3', tag: 'b', isDeleted: true },
    ]);
    expect(r.updatedRows.map((x) => (x['TagEvent'] as { Tags: string[] }).Tags)).toEqual([
      ['a'],
      ['c'],
    ]);
  });
  it('Override tags adds missing and deletes extra, result equals selection', () => {
    const r = buildTagRequests(
      [saved],
      input({
        determinationAction: 'Ignore',
        commentAction: 'Ignore',
        tagAction: 'Override',
        tags: ['b', 'z'],
      }),
    );
    expect(r.tags).toEqual([
      { eventId: 'e2', tag: 'z', isDeleted: false },
      { eventId: 'e2', tag: 'a', isDeleted: true },
    ]);
    expect(r.updatedRows[0]?.['TagEvent']).toMatchObject({ Tags: ['b', 'z'] });
  });
  it('all three requests together', () => {
    const r = buildTagRequests([unsaved], input({ tagAction: 'Append', tags: ['t'] }));
    expect(r.savedEvents).toHaveLength(1);
    expect(r.comments).toHaveLength(1);
    expect(r.tags).toEqual([{ eventId: 'e1', tag: 't', isDeleted: false }]);
  });
  it('Remove determination sends deleted removed/removed comments and clears TagEvent', () => {
    const r = buildTagRequests(
      [saved, saved2],
      input({ determinationAction: 'Remove', commentAction: 'Ignore' }),
    );
    expect(r.savedEvents).toEqual([]);
    expect(r.tags).toEqual([]);
    expect(r.comments).toEqual([
      { eventId: 'e2', comment: 'removed', determination: 'removed', isDeleted: true },
      { eventId: 'e3', comment: 'removed', determination: 'removed', isDeleted: true },
    ]);
    expect(r.updatedRows.map((x) => x['TagEvent'])).toEqual([null, null]);
  });
  it('does not mutate the input rows', () => {
    const before = JSON.stringify([unsaved, saved]);
    buildTagRequests([unsaved, saved], input({ tagAction: 'Override', tags: ['q'] }));
    expect(JSON.stringify([unsaved, saved])).toBe(before);
  });
});

describe('buildQuickTagRequests / canTag', () => {
  it('saves unsaved rows, comments carry only a lower-case determination', () => {
    const r = buildQuickTagRequests([unsaved, saved], 'Malicious');
    expect(r.savedEvents.map((e) => e.eventId)).toEqual(['e1']);
    expect(r.comments).toEqual([
      { eventId: 'e1', determination: 'malicious', isDeleted: false },
      { eventId: 'e2', determination: 'malicious', isDeleted: false },
    ]);
    expect(r.updatedRows.map((x) => x['TagEvent'])).toEqual([
      { Determination: 'malicious', IsSaved: true },
      { IsSaved: true, Determination: 'malicious', Comment: 'old', Tags: ['a', 'b'] },
    ]);
  });
  it('canTag needs EventId and EventTime on every row', () => {
    expect(canTag([unsaved, saved])).toBe(true);
    expect(canTag([unsaved, { EventId: 'x' }])).toBe(false);
    expect(canTag([{ EventTime: 't' }])).toBe(false);
    expect(canTag([])).toBe(false);
  });
});
