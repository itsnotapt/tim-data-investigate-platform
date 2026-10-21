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
  if (param.many && Array.isArray(value)) {
    const shown = value
      .slice(0, MAX_SHOWN)
      .map((v) => valueText(v))
      .join(', ');
    return clip(value.length > MAX_SHOWN ? `${shown} +${value.length - MAX_SHOWN}` : shown);
  }
  return clip(typeof value === 'object' ? JSON.stringify(value) : valueText(value));
}
