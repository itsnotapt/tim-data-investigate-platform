import type { QueryTemplate } from '../../lib/api';

export type SortKey = 'name' | 'queryType' | 'menu' | 'updated' | 'path' | 'cluster';
export type SortOrder = 'asc' | 'desc';

const cell = (t: QueryTemplate, key: SortKey): string =>
  key === 'path' ? (t.path ?? []).join(', ') : String(t[key] ?? '');

/** Hides deleted rows unless asked; `search` is a case-insensitive substring over the columns. */
export function filterTemplates(
  templates: QueryTemplate[],
  search: string,
  showDeleted: boolean,
): QueryTemplate[] {
  const needle = search.trim().toLowerCase();
  const keys: SortKey[] = ['name', 'queryType', 'menu', 'updated', 'path', 'cluster'];
  return templates.filter(
    (t) =>
      (showDeleted || t.isDeleted !== true) &&
      (needle === '' || keys.some((k) => cell(t, k).toLowerCase().includes(needle))),
  );
}

export function sortTemplates(
  templates: QueryTemplate[],
  key: SortKey,
  order: SortOrder,
): QueryTemplate[] {
  const sign = order === 'asc' ? 1 : -1;
  return [...templates].sort(
    (a, b) =>
      sign *
      cell(a, key).localeCompare(cell(b, key), undefined, { numeric: true, sensitivity: 'base' }),
  );
}

/**
 * Button state. Restore is enabled by the number of deleted rows selected (legacy used the
 * delete count, BUG-24). Delete is disabled if any selected template is managed (legacy parity).
 */
export function selectionCounts(selected: QueryTemplate[]) {
  const deleteRows = selected.filter((t) => t.isDeleted !== true);
  const restoreRows = selected.filter((t) => t.isDeleted === true);
  return {
    deleteRows,
    restoreRows,
    delete: deleteRows.length,
    restore: restoreRows.length,
    hasManaged: selected.some((t) => t.isManaged === true),
  };
}
