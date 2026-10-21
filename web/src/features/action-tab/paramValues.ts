import type { CatalogueParam, InstanceConnection } from '../../lib/api';
import { scalarText } from '../grid/columns';

type Kind = CatalogueParam['kind'];

/** A param's value parsed from text, or why it can't be. Empty text is `{value: undefined}`. */
export type Parsed = { value: unknown; error?: undefined } | { value?: undefined; error: string };

const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/i;
const NUM = String.raw`\d+(?:\.\d+)?`;
const ISO_DURATION = new RegExp(
  String.raw`^-?P(?=\d|T\d)(?:${NUM}W)?(?:${NUM}D)?(?:T(?=\d)(?:${NUM}H)?(?:${NUM}M)?(?:${NUM}S)?)?$`,
  'i',
);
const CLOCK_DURATION = /^-?\d+:\d{2}:\d{2}(\.\d+)?$/;

/** Parses one value typed for a param of `kind`; the same rules as the server's. */
export function parseParamText(kind: Kind, text: string): Parsed {
  const trimmed = text.trim();
  if (trimmed === '') return { value: undefined };
  switch (kind) {
    case 'number': {
      const n = Number(trimmed);
      return Number.isFinite(n) ? { value: n } : { error: 'Must be a number' };
    }
    case 'datetime':
      return ISO_DATETIME.test(trimmed) && !Number.isNaN(Date.parse(trimmed))
        ? { value: trimmed }
        : { error: 'Must be an ISO 8601 datetime' };
    case 'timespan':
      return ISO_DURATION.test(trimmed) || CLOCK_DURATION.test(trimmed)
        ? { value: trimmed }
        : { error: 'Must be an ISO 8601 duration or HH:MM:SS' };
    case 'json':
      try {
        return { value: JSON.parse(trimmed) as unknown };
      } catch {
        return { error: 'Must be JSON' };
      }
    default:
      return { value: text };
  }
}

export type TimespanUnit = 'days' | 'hours' | 'minutes' | 'seconds';

/** Seconds per unit, largest first. */
export const TIMESPAN_UNITS: readonly (readonly [TimespanUnit, number])[] = [
  ['days', 86400],
  ['hours', 3600],
  ['minutes', 60],
  ['seconds', 1],
];

const ISO_PART = /(-?\d+(?:\.\d+)?)([WDHMS])/gi;
const ISO_PART_SECONDS: Record<string, number> = { W: 604800, D: 86400, H: 3600, M: 60, S: 1 };

/** A valid timespan's length in seconds; `null` for anything else. */
export function timespanSeconds(text: string): number | null {
  const trimmed = text.trim();
  const sign = trimmed.startsWith('-') ? -1 : 1;
  if (CLOCK_DURATION.test(trimmed)) {
    const [h = 0, m = 0, s = 0] = trimmed.replace(/^-/, '').split(':').map(Number);
    return sign * (h * 3600 + m * 60 + s);
  }
  if (!ISO_DURATION.test(trimmed)) return null;
  const [date = '', time = ''] = trimmed.toUpperCase().split('T');
  let total = 0;
  for (const [part, isTime] of [
    [date, false],
    [time, true],
  ] as const) {
    for (const [, n, unit = ''] of part.matchAll(ISO_PART)) {
      // An `M` before the `T` would be months, which the duration pattern already rejects.
      total +=
        Number(n) *
        (isTime && unit.toUpperCase() === 'M' ? 60 : (ISO_PART_SECONDS[unit.toUpperCase()] ?? 0));
    }
  }
  return sign * total;
}

/** A timespan as an amount of its largest whole unit. */
export function timespanParts(seconds: number): { amount: number; unit: TimespanUnit } {
  const found = TIMESPAN_UNITS.find(([, size]) => seconds !== 0 && seconds % size === 0);
  const [unit, size] = found ?? ['seconds', 1];
  return { amount: seconds / size, unit };
}

/** An amount of a unit as an ISO 8601 duration. */
export function timespanValue(amount: number, unit: TimespanUnit): string {
  switch (unit) {
    case 'days':
      return `P${amount}D`;
    case 'hours':
      return `PT${amount}H`;
    case 'minutes':
      return `PT${amount}M`;
    case 'seconds':
      return `PT${amount}S`;
  }
}

/** A timespan as words: "90 minutes", "1 second". */
export function timespanText(seconds: number): string {
  const { amount, unit } = timespanParts(seconds);
  return `${amount} ${amount === 1 ? unit.slice(0, -1) : unit}`;
}

/** An ISO datetime in UTC, as the pill shows it. */
export function datetimeText(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** Splits pasted text into values: one per line, tab, comma or semicolon. */
export function splitPasted(text: string): string[] {
  return text
    .split(/[\r\n\t,;]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** A value as text in an editor. */
export function valueText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return scalarText(value);
}

export const isUnset = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

const MAX_SHOWN = 3;
const MAX_TEXT = 40;
const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);

/** The value as a pill shows it. */
export function summarize(
  param: CatalogueParam,
  value: unknown,
  connections: readonly InstanceConnection[],
): string {
  if (isUnset(value)) return 'not set';
  if (param.kind === 'boolean') return value === true ? 'on' : 'off';
  if (param.kind === 'connection') {
    return connections.find((c) => c.name === value)?.title ?? String(value);
  }
  if (param.kind === 'datetime' && typeof value === 'string') return datetimeText(value);
  if (param.kind === 'timespan' && typeof value === 'string') {
    const seconds = timespanSeconds(value);
    if (seconds !== null) return timespanText(seconds);
  }
  if (param.many && Array.isArray(value)) {
    const shown = value
      .slice(0, MAX_SHOWN)
      .map((v) => valueText(v))
      .join(', ');
    return clip(value.length > MAX_SHOWN ? `${shown} +${value.length - MAX_SHOWN}` : shown);
  }
  return clip(typeof value === 'object' ? JSON.stringify(value) : valueText(value));
}
