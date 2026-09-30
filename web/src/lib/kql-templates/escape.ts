/**
 * KQL string-literal escaping (SEC-06, Q-024).
 *
 * TIM templates quote values as verbatim literals `@'...'` (legacy `array` helper). In a verbatim
 * literal a backslash is an ordinary character and the only escape is a doubled quote, so
 * `escapeKqlVerbatim` doubles `'` (and nothing else: `"` is literal inside `@'...'`).
 */
export function escapeKqlVerbatim(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Escape for a regular (non-verbatim) literal `'...'` or `"..."`: backslash first, then quotes and
 * control characters.
 */
export function escapeKqlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/** Scalar to text. Nullish is empty (Handlebars behaviour); objects use their `value` or JSON. */
export function stringifyValue(item: unknown): string {
  if (item === null || item === undefined) return '';
  if (typeof item === 'string') return item;
  if (typeof item === 'number' || typeof item === 'boolean' || typeof item === 'bigint') {
    return String(item);
  }
  if (typeof item === 'object' && 'value' in item) return stringifyValue(item.value);
  return JSON.stringify(item) ?? '';
}

/** `@'a','b'` for each item, quotes doubled. Nullish input yields '' (legacy `items?.map`). */
export function kqlVerbatimList(items: unknown): string {
  if (items === null || items === undefined) return '';
  const list = Array.isArray(items) ? (items as unknown[]) : [items];
  return list.map((item) => `@'${escapeKqlVerbatim(stringifyValue(item))}'`).join(',');
}
