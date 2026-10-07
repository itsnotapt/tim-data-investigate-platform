/**
 * Pure time-range model for ad-hoc Kusto queries. All values are UTC.
 *
 * A range is either absolute (fixed start/end) or relative ("ago" offsets evaluated at
 * execution time via {@link resolveTimeRange}). Ranges are plain JSON-serialisable data.
 */

export type TimeUnit = 'minutes' | 'hours' | 'days';

const TIME_UNITS: readonly TimeUnit[] = ['minutes', 'hours', 'days'];

/** An offset into the past, e.g. 15 minutes ago. */
export interface AgoOffset {
  amount: number;
  unit: TimeUnit;
}

export interface AbsoluteTimeRange {
  kind: 'absolute';
  /** ISO 8601 UTC instants. */
  start: string;
  end: string;
}

export interface RelativeTimeRange {
  kind: 'relative';
  start: AgoOffset;
  /** `null` means "now". */
  end: AgoOffset | null;
}

export type TimeRange = AbsoluteTimeRange | RelativeTimeRange;

export interface ResolvedTimeRange {
  start: Date;
  end: Date;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const MINUTE_MS = 60 * 1000;
const UNIT_MS: Record<TimeUnit, number> = {
  minutes: MINUTE_MS,
  hours: 60 * MINUTE_MS,
  days: 24 * 60 * MINUTE_MS,
};

const START_BEFORE_END_ERROR = 'Start time must be prior to end time';

export const relativeRange = (
  start: AgoOffset,
  end: AgoOffset | null = null,
): RelativeTimeRange => ({
  kind: 'relative',
  start,
  end,
});

export const absoluteRange = (start: Date, end: Date): AbsoluteTimeRange => ({
  kind: 'absolute',
  start: start.toISOString(),
  end: end.toISOString(),
});

const offsetMs = ({ amount, unit }: AgoOffset): number => amount * UNIT_MS[unit];

/** Resolve to concrete UTC instants. Call at execution time; relative ranges depend on `now`. */
export function resolveTimeRange(range: TimeRange, now: Date = new Date()): ResolvedTimeRange {
  if (range.kind === 'absolute') {
    return { start: new Date(range.start), end: new Date(range.end) };
  }
  const nowMs = now.getTime();
  return {
    start: new Date(nowMs - offsetMs(range.start)),
    end: new Date(range.end === null ? nowMs : nowMs - offsetMs(range.end)),
  };
}

/** Validation errors for a range (empty when valid). Evaluated against `now` for relative ranges. */
export function validateTimeRange(range: TimeRange, now: Date = new Date()): string[] {
  const { start, end } = resolveTimeRange(range, now);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return ['Invalid time'];
  }
  return start.getTime() >= end.getTime() ? [START_BEFORE_END_ERROR] : [];
}

// ---------------------------------------------------------------------------------------
// UTC formatting

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` in UTC. */
export const formatUtcDate = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

/** `HH:MM` in UTC. */
export const formatUtcTime = (d: Date): string =>
  `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;

/** `YYYY-MM-DDTHH:MMZ` in UTC. */
export const formatUtcMinute = (d: Date): string => `${d.toISOString().substring(0, 16)}Z`;

// ---------------------------------------------------------------------------------------
// Labels

/** "<n> <unit>"; no singular ("1 hours"). */
const offsetText = (o: AgoOffset): string => `${o.amount} ${o.unit}`;

/** Label shown on the picker button / menu. */
export function timeRangeLabel(range: TimeRange): string {
  if (range.kind === 'absolute') {
    const start = new Date(range.start);
    const end = new Date(range.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Invalid time';
    return `${formatUtcMinute(start)} - ${formatUtcMinute(end)}`;
  }
  if (range.end === null) return `Last ${offsetText(range.start)}`;
  return `${offsetText(range.start)} ago - ${offsetText(range.end)} ago`;
}

// ---------------------------------------------------------------------------------------
// Custom period parsing

/** Parse "amount + unit". Rejects empty, non-numeric, NaN, Infinity, zero and negatives. */
function parseAgoOffset(
  input: string | number | null | undefined,
  unit: TimeUnit,
): Parsed<AgoOffset> {
  if (!TIME_UNITS.includes(unit)) return { ok: false, error: 'Unknown time unit' };
  const text = typeof input === 'number' ? String(input) : (input ?? '').trim();
  if (text === '') return { ok: false, error: 'Please input a time period' };
  const amount = Number(text);
  if (!Number.isFinite(amount)) return { ok: false, error: 'Time period must be a number' };
  if (amount <= 0) return { ok: false, error: 'Time period must be greater than zero' };
  return { ok: true, value: { amount, unit } };
}

export interface CustomPeriodInput {
  startAmount: string | number | null | undefined;
  startUnit: TimeUnit;
  /** `'now'` or a unit. */
  endUnit: TimeUnit | 'now';
  endAmount?: string | number | null;
}

/** Build a relative range from the "Custom time period" form; returns all errors. */
export function parseCustomPeriod(
  input: CustomPeriodInput,
  now: Date = new Date(),
): { ok: true; value: RelativeTimeRange } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const start = parseAgoOffset(input.startAmount, input.startUnit);
  if (!start.ok) errors.push(`Start: ${start.error}`);

  let end: AgoOffset | null = null;
  if (input.endUnit !== 'now') {
    const parsed = parseAgoOffset(input.endAmount, input.endUnit);
    if (parsed.ok) end = parsed.value;
    else errors.push(`End: ${parsed.error}`);
  }
  if (errors.length > 0 || !start.ok) return { ok: false, errors };

  const range = relativeRange(start.value, end);
  const rangeErrors = validateTimeRange(range, now);
  return rangeErrors.length > 0 ? { ok: false, errors: rangeErrors } : { ok: true, value: range };
}

// ---------------------------------------------------------------------------------------
// Custom absolute date range parsing

/** Time regex: H:MM or HH:MM with optional trailing Z. */
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)Z?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a UTC `YYYY-MM-DD` + `HH:MM[Z]` pair into a Date. Rejects non-existent dates. */
export function parseUtcDateTime(date: string, time: string): Parsed<Date> {
  const d = DATE_RE.exec(date.trim());
  if (!d) return { ok: false, error: 'Please input date (YYYY-MM-DD)' };
  const t = TIME_RE.exec(time.trim());
  if (!t) return { ok: false, error: 'Please input time (HH:MM)' };
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const result = new Date(Date.UTC(year, month - 1, day, Number(t[1]), Number(t[2])));
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    return { ok: false, error: 'Please input a valid date' };
  }
  return { ok: true, value: result };
}

export interface CustomDateRangeInput {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

/** Build an absolute range from the "Custom date range" form; returns all errors. */
export function parseCustomDateRange(
  input: CustomDateRangeInput,
): { ok: true; value: AbsoluteTimeRange } | { ok: false; errors: string[] } {
  const start = parseUtcDateTime(input.startDate, input.startTime);
  const end = parseUtcDateTime(input.endDate, input.endTime);
  const errors: string[] = [];
  if (!start.ok) errors.push(`Start: ${start.error}`);
  if (!end.ok) errors.push(`End: ${end.error}`);
  if (!start.ok || !end.ok) return { ok: false, errors };
  if (start.value.getTime() >= end.value.getTime())
    return { ok: false, errors: [START_BEFORE_END_ERROR] };
  return { ok: true, value: absoluteRange(start.value, end.value) };
}
