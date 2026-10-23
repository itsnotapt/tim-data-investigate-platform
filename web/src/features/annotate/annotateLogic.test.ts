import { describe, expect, it } from 'vitest';
import type { Annotations, InstanceLabel } from '../../lib/api';
import {
  addTag,
  changeBody,
  labelNow,
  NO_TAG_EDITS,
  reachLine,
  reachOf,
  removeTag,
  suggestionGroups,
  tagChips,
  undoRemoval,
} from './annotateLogic';

const tagged = (id: string, tags: string[]): Annotations => ({
  id,
  label: null,
  tags,
  comments: [],
  version: 1,
});

/** Three targets: c2 on all of them, beacon on two, tor on one. */
const current = [
  tagged('a', ['beacon', 'c2', 'tor']),
  tagged('b', ['beacon', 'c2']),
  tagged('c', ['c2']),
];

const shown = (chips: ReturnType<typeof tagChips>) =>
  chips.map((c) => [c.tag, c.state, c.count, c.total] as const);

describe('tagChips', () => {
  it('shows each tag of the targets once, the ones on every target first', () => {
    expect(shown(tagChips(current, 3, NO_TAG_EDITS))).toEqual([
      ['c2', 'all', 3, 3],
      ['beacon', 'partial', 2, 3],
      ['tor', 'partial', 1, 3],
    ]);
  });

  it('counts a target without annotations as having no tags', () => {
    expect(shown(tagChips([tagged('a', ['c2'])], 2, NO_TAG_EDITS))).toEqual([
      ['c2', 'partial', 1, 2],
    ]);
  });

  it('adding a partial tag puts it on every target', () => {
    const edits = addTag(NO_TAG_EDITS, 'beacon');
    expect(edits.add).toEqual(['beacon']);
    expect(shown(tagChips(current, 3, edits))[1]).toEqual(['beacon', 'adding', 3, 3]);
  });

  it('adds a new tag, trimmed, after the existing ones and only once', () => {
    const edits = addTag(addTag(NO_TAG_EDITS, ' ransomware '), 'ransomware');
    expect(shown(tagChips(current, 3, edits)).at(-1)).toEqual(['ransomware', 'adding', 3, 3]);
    expect(edits.add).toEqual(['ransomware']);
  });

  it('ignores a blank tag', () => {
    expect(addTag(NO_TAG_EDITS, '  ')).toEqual(NO_TAG_EDITS);
  });

  it('removing an existing tag strikes it through, and undo brings it back as it was', () => {
    const removed = removeTag(addTag(NO_TAG_EDITS, 'beacon'), 'beacon', current);
    expect(removed).toEqual({ add: [], remove: ['beacon'] });
    expect(shown(tagChips(current, 3, removed))[1]).toEqual(['beacon', 'removing', 2, 3]);
    const undone = undoRemoval(removed, 'beacon');
    expect(shown(tagChips(current, 3, undone))[1]).toEqual(['beacon', 'partial', 2, 3]);
  });

  it('removing a tag no target has just drops it', () => {
    const edits = removeTag(addTag(NO_TAG_EDITS, 'new'), 'new', current);
    expect(edits).toEqual(NO_TAG_EDITS);
    expect(tagChips(current, 3, edits)).toHaveLength(3);
  });

  it('adding a struck-through tag again undoes its removal and adds it to all', () => {
    const edits = addTag(removeTag(NO_TAG_EDITS, 'tor', current), 'tor');
    expect(edits).toEqual({ add: ['tor'], remove: [] });
  });
});

describe('reachOf and reachLine', () => {
  const index = new Map([
    ['h1', ['0', '1', '2']],
    ['h2', ['3']],
    ['h3', ['4', '5']],
  ]);

  it('counts the rows, their ids, the other rows with those ids and the rows without one', () => {
    const rows = [{ id: 'h1' }, { id: 'h1' }, { id: 'h2' }, { id: null }, {}];
    const reach = reachOf(rows, index);
    expect(reach).toEqual({ rows: 5, ids: 2, otherRows: 1, withoutId: 2 });
    expect(reachLine(reach)).toBe(
      '5 rows · 2 ids · also changes 1 other row with the same id · 2 rows without an id are skipped',
    );
  });

  it('leaves out the other rows and the skipped rows when there are none', () => {
    const reach = reachOf([{ id: 'h2' }], index);
    expect(reachLine(reach)).toBe('1 row · 1 id');
  });

  it('says one skipped row in the singular', () => {
    expect(reachLine({ rows: 1_200, ids: 3, otherRows: 4, withoutId: 1 })).toBe(
      '1,200 rows · 3 ids · also changes 4 other rows with the same id · 1 row without an id is skipped',
    );
  });
});

describe('labelNow', () => {
  const labels: InstanceLabel[] = [
    { key: 'malicious', name: 'Malicious', colour: 'red', symbol: null },
    { key: 'benign', name: 'Benign', colour: 'green', symbol: null },
  ];
  const labelled = (id: string, key: string): Annotations => ({
    id,
    label: { key, by: 'alice@example.com', at: '2026-10-21T10:00:00Z' },
    tags: [],
    comments: [],
    version: 1,
  });

  it("names the targets' one label", () => {
    expect(labelNow([labelled('a', 'malicious'), labelled('b', 'malicious')], 2, labels)).toBe(
      'Now: Malicious',
    );
  });

  it('says when no target has a label', () => {
    expect(labelNow([tagged('a', ['c2'])], 2, labels)).toBe('Now: no label');
  });

  it('counts each label when the targets differ, unlabelled ones included', () => {
    expect(
      labelNow(
        [labelled('a', 'malicious'), labelled('b', 'benign'), labelled('c', 'malicious')],
        4,
        labels,
      ),
    ).toBe('Now: 2 Malicious · 1 Benign · 1 no label');
  });
});

describe('changeBody', () => {
  const nothing = { label: undefined, edits: NO_TAG_EDITS, comment: '' };

  it('is null when the dialog changes nothing', () => {
    expect(changeBody(['a'], { ...nothing, comment: '  ' })).toBeNull();
  });

  it('keeps the label by leaving it out, and sends only the parts that change', () => {
    expect(
      changeBody(['a', 'b'], {
        label: undefined,
        edits: { add: ['c2'], remove: ['tor'] },
        comment: ' beacons \n',
      }),
    ).toEqual({ ids: ['a', 'b'], addTags: ['c2'], removeTags: ['tor'], comment: 'beacons' });
  });

  it('sets a label, or clears it with null', () => {
    expect(changeBody(['a'], { ...nothing, label: 'benign' })).toEqual({
      ids: ['a'],
      label: 'benign',
    });
    expect(changeBody(['a'], { ...nothing, label: null })).toEqual({ ids: ['a'], label: null });
  });
});

describe('suggestionGroups', () => {
  it("groups the analyst's recent tags and the most used, each tag once", () => {
    expect(
      suggestionGroups('b', ['c2'], {
        recent: ['beacon', 'Botnet', 'c2'],
        mostUsed: ['bad', 'Botnet', 'banking'],
      }),
    ).toEqual([
      { group: 'Your recent tags', tags: ['beacon', 'Botnet'] },
      { group: 'Most used', tags: ['bad', 'banking'] },
    ]);
  });

  it("leaves out the editor's tags and the groups with nothing left", () => {
    expect(
      suggestionGroups('', ['c2', 'tor'], {
        recent: ['tor', 'c2'],
        mostUsed: ['beacon'],
      }),
    ).toEqual([{ group: 'Most used', tags: ['beacon'] }]);
  });
});
