import { isEmpty } from '../../lib/isEmpty';

/** A run of an object line's text: a key or list dash, a string as it is, or any other value. */
export interface DetailSegment {
  text: string;
  kind: 'key' | 'plain' | 'typed';
}

/** A line of an object's layout, `indent` characters in. */
export interface DetailLine {
  indent: number;
  segments: DetailSegment[];
}

/** The run's columns, in order: the fields' order. */
export type DetailColumns = readonly { name: string }[];

export interface DetailEntry {
  key: string;
  /** The value as shown, as plain text. */
  text: string;
  /** An object's or array's lines, else `null`. */
  lines: DetailLine[] | null;
  /** What its copy button copies: an object's or array's 2-space indented JSON, else `text`. */
  copy: string;
}

/** A scalar, or an empty array or object: strings as they are, every other value typed. */
function scalar(value: unknown): DetailSegment {
  if (typeof value === 'string')
    return value === '' ? { text: '""', kind: 'typed' } : { text: value, kind: 'plain' };
  if (Array.isArray(value)) return { text: '[]', kind: 'typed' };
  if (typeof value === 'object' && value !== null) return { text: '{}', kind: 'typed' };
  return { text: String(value), kind: 'typed' };
}

/** Holds more lines: a non-empty array or object. */
const isBlock = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && Object.keys(value).length > 0;

const DASH: DetailSegment = { text: '- ', kind: 'key' };

/** `head` alone on a line, for a value that continues on the lines below. */
const headLine = (head: DetailSegment, indent: number): DetailLine => ({
  indent,
  segments: [{ ...head, text: head.text.trimEnd() }],
});

/**
 * `value` after `head` (a key, or a list item's dash), on a line `indent` characters in. A list
 * item's object starts on its dash's line, as in YAML.
 */
function valueLines(
  head: DetailSegment,
  value: unknown,
  indent: number,
  listItem: boolean,
): DetailLine[] {
  if (typeof value === 'string' && value.includes('\n')) {
    return [
      headLine(head, indent),
      ...value
        .split('\n')
        .map((text) => ({ indent: indent + 2, segments: [{ text, kind: 'plain' as const }] })),
    ];
  }
  if (!isBlock(value)) return [{ indent, segments: [head, scalar(value)] }];
  const lines = objectLines(value, indent + 2);
  if (!listItem) return [headLine(head, indent), ...lines];
  const [first, ...rest] = lines;
  return first ? [{ indent, segments: [head, ...first.segments] }, ...rest] : [];
}

/** The lines of an array or object, `indent` characters in. */
function objectLines(value: object, indent: number): DetailLine[] {
  if (Array.isArray(value))
    return value.flatMap((item: unknown) => valueLines(DASH, item, indent, true));
  return Object.entries(value).flatMap(([key, v]) =>
    valueLines({ text: `${key}: `, kind: 'key' }, v, indent, false),
  );
}

const lineText = (line: DetailLine) =>
  ' '.repeat(line.indent) + line.segments.map((s) => s.text).join('');

function entry(key: string, value: unknown): DetailEntry {
  if (typeof value === 'object' && value !== null) {
    const lines = objectLines(value, 0);
    return {
      key,
      text: lines.map(lineText).join('\n'),
      lines,
      copy: JSON.stringify(value, null, 2),
    };
  }
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
        ? String(value)
        : '';
  return { key, text, lines: null, copy: text };
}

/**
 * Entries to show, in the order of `columns` (the run's columns), then any other key in the row's
 * order. Empty values are left out.
 */
export function detailEntries(
  data: Record<string, unknown> | null | undefined,
  columns: DetailColumns = [],
): DetailEntry[] {
  if (!data) return [];
  const order = new Map(columns.map((c, i) => [c.name, i]));
  const rank = (key: string) => order.get(key) ?? columns.length;
  return Object.entries(data)
    .filter(([, value]) => !isEmpty(value))
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, value]) => entry(key, value));
}
