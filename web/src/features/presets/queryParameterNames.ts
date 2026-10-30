/** What a query parameter's name must be: a Kusto identifier. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Why `name` can't be a query parameter's name, or `undefined` when it can. */
export const nameError = (name: string): string | undefined =>
  NAME.test(name) ? undefined : 'Starts with a letter or _ and holds only letters, digits and _';

// Comments, strings and numbers are skipped; what's left of a name is in the group.
const TOKEN =
  /\/\/[^\n]*|```[\s\S]*?```|@?'(?:[^'\\\n]|\\.)*'|@?"(?:[^"\\\n]|\\.)*"|\d[\w.]*|([A-Za-z_][A-Za-z0-9_]*)/g;

/** Words of KQL expressions, which are no query parameter's name. */
const KEYWORDS = new Set([
  'and',
  'or',
  'not',
  'in',
  'has',
  'by',
  'on',
  'kind',
  'with',
  'between',
  'contains',
  'startswith',
  'endswith',
  'matches',
  'regex',
  'true',
  'false',
  'asc',
  'desc',
  'nulls',
  'first',
  'last',
  'let',
  'declare',
  'query_parameters',
  'dynamic',
  'datetime',
  'timespan',
]);

/**
 * The names in `kql` that may be query parameters, in order and once each: identifiers outside
 * comments and strings that aren't a keyword, an operator after `|`, or a function called.
 */
export function kqlNames(kql: string): string[] {
  const names = new Set<string>();
  for (const match of kql.matchAll(TOKEN)) {
    const name = match[1];
    if (name === undefined || KEYWORDS.has(name)) continue;
    const before = kql.slice(0, match.index).trimEnd();
    const after = kql.slice(match.index + name.length).trimStart();
    if (!before.endsWith('|') && !after.startsWith('(')) names.add(name);
  }
  return [...names];
}
