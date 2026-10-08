import { dump } from 'js-yaml';
import { isEmpty } from '../../lib/isEmpty';
import { ROW_ID_FIELD } from './columns';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/gu;

/** Text of a detail value: objects as YAML (control characters stripped), other values as text. */
export function detailText(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    // js-yaml 5 has no `replacer` option: strip control characters through a JSON round trip.
    const clean: unknown = JSON.parse(
      JSON.stringify(value, (_key, v: unknown) =>
        typeof v === 'string' ? v.replace(CONTROL_CHARS, '') : v,
      ),
    );
    return dump(clean);
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  return '';
}

/** Entries to show: empty values and the client-only row id are hidden. */
export function detailEntries(data: Record<string, unknown> | null | undefined) {
  if (!data) return [];
  return Object.entries(data)
    .filter(([key, value]) => key !== ROW_ID_FIELD && !isEmpty(value))
    .map(([key, value]) => ({ key, text: detailText(value) }));
}
