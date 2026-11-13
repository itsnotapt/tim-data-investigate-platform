/**
 * Title templates (ADR 0029): plain text with `{…}` placeholders, filled in by plain substitution.
 */
import { isUnset } from './paramValues';

/** An unset value in a title. */
const NOT_SET = '<not set>';

/** Each `{…}` placeholder, capturing what it names. */
const PLACEHOLDER = /\{([^{}]*)\}/g;

/** What a placeholder of a pivot row column starts with. */
const ROW = 'row.';

/** The pivot row column a placeholder names with `row.`, or `null` when it names a param. */
const rowColumn = (name: string): string | null =>
  name.startsWith(ROW) ? name.slice(ROW.length) : null;

/** What a title template is filled in from: a run's params and the tab's pivot rows. */
export interface TitleValues {
  params: Record<string, unknown>;
  pivotRows?: readonly Record<string, unknown>[];
}

/** A value as a title shows it: a string as it is, anything else as JSON. */
const text = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value);

/**
 * A value in a title: an unset one as `<not set>`, a list as `[a]`, `[a, b]` or `[a, b, … +N]`,
 * anything else as `text` shows it.
 */
function shown(value: unknown): string {
  if (isUnset(value)) return NOT_SET;
  if (!Array.isArray(value)) return text(value);
  const values = value.slice(0, 2).map(text);
  if (value.length > 2) values.push(`… +${value.length - 2}`);
  return `[${values.join(', ')}]`;
}

/** `record`'s own value of `key`, never one every object inherits. */
const own = (record: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(record, key) ? record[key] : undefined;

/** The distinct values of `column` in `rows`, in first-seen order, leaving out unset ones. */
function columnValues(rows: readonly Record<string, unknown>[], column: string): unknown[] {
  const seen = new Map<string, unknown>();
  for (const row of rows) {
    const value = own(row, column);
    if (isUnset(value)) continue;
    const key = JSON.stringify(value);
    if (!seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()];
}

/** The value of a `{row.X}` placeholder: the one value the rows have, else their values. */
function rowValue(rows: readonly Record<string, unknown>[], column: string): unknown {
  const values = columnValues(rows, column);
  return values.length === 1 ? values[0] : values;
}

/**
 * `template` with each placeholder replaced by the value it names: `{name}` the param's,
 * `{row.X}` the pivot rows' column `X`.
 */
export const fillIn = (template: string, { params, pivotRows = [] }: TitleValues): string =>
  template.replace(PLACEHOLDER, (_, name: string) => {
    const column = rowColumn(name);
    return shown(column === null ? own(params, name) : rowValue(pivotRows, column));
  });

/**
 * The title columns of `template`: the pivot row columns it names with `row.`, each once, in order.
 * They are the only columns a tab keeps of its pivot rows.
 */
export const titleColumns = (template: string | null | undefined): string[] => [
  ...new Set(
    [...(template ?? '').matchAll(PLACEHOLDER)]
      .map(([, name = '']) => rowColumn(name))
      .filter((column) => column !== null),
  ),
];
