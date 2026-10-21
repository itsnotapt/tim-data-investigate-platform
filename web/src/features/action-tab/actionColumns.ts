import type { ColDef } from 'ag-grid-community';
import type { CatalogueColumn, RunColumn, RunRow } from '../../lib/api';

/**
 * Grid columns of an action's results, in the run's order (declared first, then inferred), else
 * the action's declared order. Values come from each row's `data`, so a result column called `row`
 * or `id` keeps its own values. Declared settings are AG Grid `initial*` settings, so a restored
 * column state wins over them.
 */
export function buildActionColumnDefs(
  declaredColumns: readonly CatalogueColumn[] | null | undefined,
  runColumns: readonly RunColumn[] | null | undefined,
): ColDef[] {
  const byName = new Map((declaredColumns ?? []).map((c) => [c.name, c]));
  const names =
    runColumns?.map((c) => c.name) ??
    (declaredColumns ?? []).filter((c) => !c.calculated).map((c) => c.name);
  return names.map((name) => {
    const column = byName.get(name);
    return {
      colId: name,
      headerName: column?.title ?? name,
      valueGetter: (p) => (p.data as RunRow | undefined)?.data[name],
      ...(column && {
        initialHide: column.hidden,
        initialWidth: column.width ?? undefined,
        initialPinned: column.pinned ?? undefined,
        initialSort: column.sort ?? undefined,
        initialRowGroup: column.group,
      }),
    };
  });
}
