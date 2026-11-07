import { describe, expect, it } from 'vitest';
import { noIdReason, whyUnlabellable } from './labelling';

describe('why rows can’t be annotated', () => {
  it('says why a row has no id: no Id column, an empty value, or an Id column with duplicates', () => {
    expect(noIdReason(null, 0)).toBe('No id: no Id column');
    expect(noIdReason('Device', 0)).toBe('No id: Device is empty here');
    expect(noIdReason('Host', 1_500)).toBe('No id: 1,500 duplicates found in Host');
  });

  it('gives that reason for rows without ids, and the cap for too many', () => {
    const noId = noIdReason('Host', 150);
    expect(whyUnlabellable([], 10, noId)).toBe('No id: 150 duplicates found in Host');
    expect(whyUnlabellable(['a', 'b', 'c'], 2, noId)).toBe('At most 2 ids; 3 selected');
    expect(whyUnlabellable(['a'], 2, noId)).toBeNull();
  });
});
