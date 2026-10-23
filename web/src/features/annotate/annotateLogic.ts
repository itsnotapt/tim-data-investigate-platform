import type { Annotations, AnnotationsChange, InstanceLabel, TagSuggestions } from '../../lib/api';
import { shownLabel } from '../labels/labels';

/** What the Annotate dialog edits: tags and a comment, or the comment alone. */
export type AnnotateMode = 'annotate' | 'comment';

const count = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

/** The tags the analyst adds to every target, and the tags they remove from every target. */
export interface TagEdits {
  add: readonly string[];
  remove: readonly string[];
}

export const NO_TAG_EDITS: TagEdits = { add: [], remove: [] };

/**
 * A tag in the tag editor.
 * - `all`: on every target.
 * - `partial`: on `count` of the `total` targets; adding it puts it on all of them.
 * - `adding`: to be added to every target.
 * - `removing`: to be removed from every target (struck through).
 */
export interface TagChip {
  tag: string;
  state: 'all' | 'partial' | 'adding' | 'removing';
  count: number;
  total: number;
}

/** How many of `current` have each tag. */
function tagCounts(current: readonly Annotations[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const annotations of current) {
    for (const tag of annotations.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

/**
 * The tag editor's chips for `total` targets whose annotations are `current` (targets without any
 * left out), after `edits`: the targets' tags, on the most targets first, then the new tags in the
 * order they were added.
 */
export function tagChips(
  current: readonly Annotations[],
  total: number,
  edits: TagEdits,
): TagChip[] {
  const counts = tagCounts(current);
  const existing = [...counts].sort(([a, m], [b, n]) => n - m || (a < b ? -1 : a > b ? 1 : 0));
  const chip = (tag: string, count: number): TagChip => {
    if (edits.remove.includes(tag)) return { tag, state: 'removing', count, total };
    if (edits.add.includes(tag)) return { tag, state: 'adding', count: total, total };
    return { tag, state: count >= total ? 'all' : 'partial', count, total };
  };
  return [
    ...existing.map(([tag, count]) => chip(tag, count)),
    ...edits.add.filter((tag) => !counts.has(tag)).map((tag) => chip(tag, 0)),
  ];
}

/** `edits` with `tag`, trimmed, added to every target. A blank tag changes nothing. */
export function addTag(edits: TagEdits, tag: string): TagEdits {
  const trimmed = tag.trim();
  if (trimmed === '') return edits;
  return {
    add: edits.add.includes(trimmed) ? edits.add : [...edits.add, trimmed],
    remove: edits.remove.filter((t) => t !== trimmed),
  };
}

/**
 * `edits` with `tag` removed from every target. A tag none of `current` has is just no longer
 * added.
 */
export function removeTag(edits: TagEdits, tag: string, current: readonly Annotations[]): TagEdits {
  const add = edits.add.filter((t) => t !== tag);
  const existing = current.some((a) => a.tags?.includes(tag));
  if (!existing || edits.remove.includes(tag)) return { ...edits, add };
  return { add, remove: [...edits.remove, tag] };
}

/** `edits` without the removal of `tag`: it goes back to the targets it was on. */
export function undoRemoval(edits: TagEdits, tag: string): TagEdits {
  return { ...edits, remove: edits.remove.filter((t) => t !== tag) };
}

/** Which rows a change to the targets reaches. */
export interface Reach {
  /** The target rows. */
  rows: number;
  /** Their distinct `id`s: what the change is sent for. */
  ids: number;
  /** The grid's other rows with one of those `id`s, which change with them. */
  otherRows: number;
  /** The target rows without an `id`, which the change skips. */
  withoutId: number;
}

/** The reach of a change to `rows`, given the grid's rows of each `id`. */
export function reachOf(
  rows: readonly { id?: string | null }[],
  rowsById: ReadonlyMap<string, readonly string[]>,
): Reach {
  const withId = rows.flatMap((r) => (r.id ? [r.id] : []));
  const ids = new Set(withId);
  let reached = 0;
  for (const id of ids) reached += rowsById.get(id)?.length ?? 1;
  return {
    rows: rows.length,
    ids: ids.size,
    otherRows: Math.max(0, reached - withId.length),
    withoutId: rows.length - withId.length,
  };
}

/** "N rows · M ids · also changes K other rows with the same id · X rows without an id are skipped". */
export function reachLine({ rows, ids, otherRows, withoutId }: Reach): string {
  return [
    plural(rows, 'row', 'rows'),
    plural(ids, 'id', 'ids'),
    ...(otherRows > 0
      ? [`also changes ${plural(otherRows, 'other row', 'other rows')} with the same id`]
      : []),
    ...(withoutId > 0
      ? [
          withoutId === 1
            ? '1 row without an id is skipped'
            : `${count(withoutId)} rows without an id are skipped`,
        ]
      : []),
  ].join(' · ');
}

/**
 * "Now: …": the label of `total` targets whose annotations are `current` (targets without any left
 * out), or how many have each label when they differ.
 */
export function labelNow(
  current: readonly Annotations[],
  total: number,
  labels: readonly InstanceLabel[],
): string {
  const counts = new Map<string, number>();
  for (const a of current) {
    if (a.label) counts.set(a.label.key, (counts.get(a.label.key) ?? 0) + 1);
  }
  const labelled = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const name = (key: string) => shownLabel(key, labels).name;
  if (labelled === 0) return 'Now: no label';
  const [only] = counts.keys();
  if (counts.size === 1 && only !== undefined && labelled === total) return `Now: ${name(only)}`;
  const parts = [...counts].map(([key, n]) => `${count(n)} ${name(key)}`);
  if (total > labelled) parts.push(`${count(total - labelled)} no label`);
  return `Now: ${parts.join(' · ')}`;
}

/** What the analyst chose in the dialog. `label`: a key sets it, `null` clears it, `undefined` keeps it. */
export interface DialogChoice {
  label: string | null | undefined;
  edits: TagEdits;
  comment: string;
}

/** The `PATCH /api/annotations` body for `choice` on `ids`, or `null` when it changes nothing. */
export function changeBody(ids: readonly string[], choice: DialogChoice): AnnotationsChange | null {
  const comment = choice.comment.trim();
  const body: AnnotationsChange = { ids: [...ids] };
  if (choice.label !== undefined) body.label = choice.label;
  if (choice.edits.add.length > 0) body.addTags = [...choice.edits.add];
  if (choice.edits.remove.length > 0) body.removeTags = [...choice.edits.remove];
  if (comment !== '') body.comment = comment;
  return Object.keys(body).length === 1 ? null : body;
}

export interface SuggestionGroup {
  group: 'Your recent tags' | 'Most used';
  tags: string[];
}

/** Tags per suggestion group. */
const PER_GROUP = 10;

/**
 * The tag suggestions for `prefix`, ignoring case: the server's `recent`, then its `mostUsed`.
 * Each tag shows once, and tags in the editor (`taken`) not at all.
 */
export function suggestionGroups(
  prefix: string,
  taken: readonly string[],
  sources: TagSuggestions,
): SuggestionGroup[] {
  const lower = prefix.trim().toLowerCase();
  const seen = new Set(taken);
  const pick = (tags: readonly string[]) => {
    const picked: string[] = [];
    for (const tag of tags) {
      if (picked.length >= PER_GROUP || seen.has(tag)) continue;
      if (!tag.toLowerCase().startsWith(lower)) continue;
      seen.add(tag);
      picked.push(tag);
    }
    return picked;
  };
  const groups: SuggestionGroup[] = [
    { group: 'Your recent tags', tags: pick(sources.recent) },
    { group: 'Most used', tags: pick(sources.mostUsed) },
  ];
  return groups.filter((g) => g.tags.length > 0);
}

/** The toast after a saved change that changed `changed` ids. */
export function savedMessage(mode: AnnotateMode, changed: number): string {
  if (changed === 0) return 'Nothing to change';
  const ids = plural(changed, 'id', 'ids');
  return mode === 'comment' ? `Commented on ${ids}` : `Annotated ${ids}`;
}
