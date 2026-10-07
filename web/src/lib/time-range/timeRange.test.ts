import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TIME_RANGE,
  TIME_RANGE_PRESETS,
  absoluteRange,
  formatUtcDate,
  formatUtcMinute,
  formatUtcTime,
  parseCustomDateRange,
  parseCustomPeriod,
  parseUtcDateTime,
  resolveTimeRange,
  timeRangeLabel,
  validateTimeRange,
} from './index';

const NOW = new Date('2026-09-29T12:30:45.000Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('presets', () => {
  const expected: [string, number][] = [
    ['Last 15 minutes', 15 * 60_000],
    ['Last 30 minutes', 30 * 60_000],
    ['Last 1 hours', 60 * 60_000],
    ['Last 24 hours', 24 * 60 * 60_000],
    ['Last 7 days', 7 * 86_400_000],
    ['Last 30 days', 30 * 86_400_000],
    ['Last 90 days', 90 * 86_400_000],
  ];

  it('has the presets in menu order', () => {
    expect(TIME_RANGE_PRESETS.map(timeRangeLabel)).toEqual(expected.map(([l]) => l));
  });

  it.each(expected.map((e, i) => [e[0], e[1], i] as const))(
    '%s resolves to now - duration',
    (_l, ms, i) => {
      const { start, end } = resolveTimeRange(TIME_RANGE_PRESETS[i]!);
      expect(end.getTime()).toBe(NOW.getTime());
      expect(start.getTime()).toBe(NOW.getTime() - ms);
    },
  );

  it('default is Last 15 minutes', () => {
    expect(timeRangeLabel(DEFAULT_TIME_RANGE)).toBe('Last 15 minutes');
    expect(DEFAULT_TIME_RANGE).toBe(TIME_RANGE_PRESETS[0]);
  });

  it('relative ranges are evaluated at execution time', () => {
    const first = resolveTimeRange(DEFAULT_TIME_RANGE);
    vi.advanceTimersByTime(60_000);
    const second = resolveTimeRange(DEFAULT_TIME_RANGE);
    expect(second.end.getTime() - first.end.getTime()).toBe(60_000);
  });
});

describe('custom period', () => {
  it('accepts a valid period ending now', () => {
    const r = parseCustomPeriod({ startAmount: '2', startUnit: 'hours', endUnit: 'now' });
    expect(r).toEqual({
      ok: true,
      value: { kind: 'relative', start: { amount: 2, unit: 'hours' }, end: null },
    });
    if (r.ok) expect(timeRangeLabel(r.value)).toBe('Last 2 hours');
  });

  it('accepts start and end offsets and labels them', () => {
    const r = parseCustomPeriod({
      startAmount: '30',
      startUnit: 'minutes',
      endUnit: 'minutes',
      endAmount: '5',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(timeRangeLabel(r.value)).toBe('30 minutes ago - 5 minutes ago');
  });

  it.each(['abc', '', '   ', null, undefined, 'NaN', 'Infinity', '1x'])(
    'rejects non-numeric %j',
    (v) => {
      expect(parseCustomPeriod({ startAmount: v, startUnit: 'minutes', endUnit: 'now' }).ok).toBe(
        false,
      );
    },
  );

  it('rejects NaN number', () => {
    expect(parseCustomPeriod({ startAmount: NaN, startUnit: 'days', endUnit: 'now' }).ok).toBe(
      false,
    );
  });

  it.each(['0', '-5', 0, -1, '-0'])('rejects zero/negative %j', (v) => {
    expect(parseCustomPeriod({ startAmount: v, startUnit: 'hours', endUnit: 'now' }).ok).toBe(
      false,
    );
  });

  it('rejects an invalid end period', () => {
    const r = parseCustomPeriod({
      startAmount: '10',
      startUnit: 'minutes',
      endUnit: 'hours',
      endAmount: 'x',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects start not before end (start ago <= end ago)', () => {
    const same = parseCustomPeriod({
      startAmount: '5',
      startUnit: 'minutes',
      endUnit: 'minutes',
      endAmount: '5',
    });
    expect(same).toEqual({ ok: false, errors: ['Start time must be prior to end time'] });
    const inverted = parseCustomPeriod({
      startAmount: '1',
      startUnit: 'hours',
      endUnit: 'days',
      endAmount: '1',
    });
    expect(inverted.ok).toBe(false);
  });
});

describe('custom date range', () => {
  const base = {
    startDate: '2026-09-01',
    startTime: '00:00',
    endDate: '2026-09-02',
    endTime: '13:45Z',
  };

  it('parses UTC dates', () => {
    const r = parseCustomDateRange(base);
    expect(r).toEqual({
      ok: true,
      value: {
        kind: 'absolute',
        start: '2026-09-01T00:00:00.000Z',
        end: '2026-09-02T13:45:00.000Z',
      },
    });
    if (r.ok) expect(timeRangeLabel(r.value)).toBe('2026-09-01T00:00Z - 2026-09-02T13:45Z');
  });

  it('accepts single digit hours', () => {
    const r = parseUtcDateTime('2026-09-01', '9:05');
    expect(r.ok && r.value.toISOString()).toBe('2026-09-01T09:05:00.000Z');
  });

  it('rejects start equal to end', () => {
    const r = parseCustomDateRange({ ...base, endDate: base.startDate, endTime: base.startTime });
    expect(r).toEqual({ ok: false, errors: ['Start time must be prior to end time'] });
  });

  it('rejects start after end', () => {
    const r = parseCustomDateRange({ ...base, startDate: '2026-09-03' });
    expect(r.ok).toBe(false);
  });

  it.each([
    ['2026-13-01', '10:00'],
    ['2026-02-30', '10:00'],
    ['09/01/2026', '10:00'],
    ['', '10:00'],
    ['2026-09-01', '24:00'],
    ['2026-09-01', '10:60'],
    ['2026-09-01', ''],
    ['2026-09-01', 'noon'],
  ])('rejects malformed %s %s', (d, t) => {
    expect(parseUtcDateTime(d, t).ok).toBe(false);
  });

  it('reports errors for both fields', () => {
    const r = parseCustomDateRange({
      startDate: 'x',
      startTime: '00:00',
      endDate: '2026-09-01',
      endTime: 'y',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });
});

describe('validateTimeRange', () => {
  it('flags absolute start >= end', () => {
    const t = new Date('2026-09-01T00:00:00Z');
    expect(validateTimeRange(absoluteRange(t, t))).toEqual([
      'Start time must be prior to end time',
    ]);
    expect(validateTimeRange(absoluteRange(t, new Date(t.getTime() + 1)))).toEqual([]);
  });

  it('flags invalid instants', () => {
    expect(validateTimeRange({ kind: 'absolute', start: 'nope', end: 'nope' })).toEqual([
      'Invalid time',
    ]);
  });

  it('presets are valid', () => {
    for (const p of TIME_RANGE_PRESETS) expect(validateTimeRange(p)).toEqual([]);
  });
});

describe('UTC formatting', () => {
  // Real-world zone must not matter.
  const d = new Date('2026-01-05T03:07:59.999Z');

  it('formats date, time and minute-precision instants in UTC', () => {
    expect(formatUtcDate(d)).toBe('2026-01-05');
    expect(formatUtcTime(d)).toBe('03:07');
    expect(formatUtcMinute(d)).toBe('2026-01-05T03:07Z');
  });

  it('labels absolute ranges', () => {
    expect(timeRangeLabel(absoluteRange(d, new Date('2026-01-06T00:00:00Z')))).toBe(
      '2026-01-05T03:07Z - 2026-01-06T00:00Z',
    );
  });

  it('labels invalid absolute range', () => {
    expect(timeRangeLabel({ kind: 'absolute', start: 'x', end: 'y' })).toBe('Invalid time');
  });
});
