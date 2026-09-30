/** Row shape helpers and set arithmetic for tags (port of legacy `helpers/tags.js`). */
export type TagRow = Record<string, unknown>;

/** The `TagEvent` object the Kusto join adds to a row (and the grid colours by). */
export interface TagEventData {
  Tags?: string[];
  Comment?: string | null;
  Determination?: string | null;
  IsSaved?: boolean;
  [key: string]: unknown;
}

export function tagEventOf(row: TagRow): TagEventData | null {
  const t = row['TagEvent'];
  return t && typeof t === 'object' && !Array.isArray(t) ? (t as TagEventData) : null;
}

/** `data.TagEvent?.Tags || []`; a non-array value counts as no tags. */
export function tagsFromRow(row: TagRow): string[] {
  const tags = tagEventOf(row)?.Tags;
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [];
}

export const isSavedRow = (row: TagRow): boolean => tagEventOf(row)?.IsSaved === true;

/** Elements of `a` not in `b`, unique, in `a` order. */
export function tagsDiff(a: readonly string[], b: readonly string[]): string[] {
  const drop = new Set(b);
  return [...new Set(a)].filter((t) => !drop.has(t));
}

/** Elements of `a` that are also in `b`, unique, in `b` order (legacy iterated `b`). */
export function tagsIntersect(a: readonly string[], b: readonly string[]): string[] {
  const have = new Set(a);
  return [...new Set(b)].filter((t) => have.has(t));
}

/** Tag to the rows that carry it, for the "Exists in N event(s)" hint. */
export function existingTagCounts(rows: readonly TagRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of new Set(tagsFromRow(row))) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

/** Recent tags are a stub in legacy (`retrieveRecentTags` returns `[]`). */
export const retrieveRecentTags = (): Promise<string[]> => Promise.resolve([]);

/**
 * Options offered by the tag autocomplete: selected + existing (+ recent unless removing), unique.
 */
export function tagOptions(
  rows: readonly TagRow[],
  selected: readonly string[],
  recent: readonly string[],
  removing: boolean,
): string[] {
  const existing = rows.flatMap(tagsFromRow);
  return [...new Set([...selected, ...existing, ...(removing ? [] : recent)])];
}
