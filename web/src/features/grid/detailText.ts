import { DUMP_SCHEMA, Schema, defineScalarTag, dump } from 'js-yaml';
import { isEmpty } from '../../lib/isEmpty';
import { parseJson, stringifyJson } from '../../lib/json';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/gu;

/** js-yaml's dump schema, with a `BigInt` dumped as a plain `!!int`. */
const BIGINT_DUMP_SCHEMA = new Schema(
  DUMP_SCHEMA.tags.map((tag) =>
    tag.tagName === 'tag:yaml.org,2002:int' && tag.nodeKind === 'scalar'
      ? defineScalarTag(tag.tagName, {
          ...tag,
          identify: (data) => typeof data === 'bigint' || tag.identify(data),
          represent: (data) => (typeof data === 'bigint' ? data.toString() : tag.represent(data)),
        })
      : tag,
  ),
);

/** Text of a detail value: objects as YAML (control characters stripped), other values as text. */
export function detailText(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    // js-yaml 5 has no `replacer` option: strip control characters through a JSON round trip.
    const clean = parseJson(
      stringifyJson(value, (_key, v) => (typeof v === 'string' ? v.replace(CONTROL_CHARS, '') : v)),
    );
    return dump(clean, { schema: BIGINT_DUMP_SCHEMA });
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value);
  return '';
}

/** Entries to show: empty values are hidden. */
export function detailEntries(data: Record<string, unknown> | null | undefined) {
  if (!data) return [];
  return Object.entries(data)
    .filter(([, value]) => !isEmpty(value))
    .map(([key, value]) => ({ key, text: detailText(value) }));
}
