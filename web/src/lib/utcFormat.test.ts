import { describe, expect, it } from 'vitest';
import { formatUtcDate, formatUtcDateTime, formatUtcTime } from './utcFormat';

describe('UTC formatting', () => {
  // Real-world zone must not matter.
  const d = new Date('2026-01-05T03:07:59.999Z');

  it('formats the date and the time in UTC', () => {
    expect(formatUtcDate(d)).toBe('2026-01-05');
    expect(formatUtcTime(d)).toBe('03:07');
    expect(formatUtcDateTime('2026-01-05T03:07:59.999Z')).toBe('2026-01-05 03:07 UTC');
  });
});
