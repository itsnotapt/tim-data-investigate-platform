import type { ColDef } from 'ag-grid-community';
import type { CatalogueColumn, RunColumn, RunRow } from '../../lib/api';

/**
 * The run's column names (else the declared ones), with each declared calculated column after the
 * declared column before it.
 */
function columnNames(
  declared: readonly CatalogueColumn[],
  runColumns: readonly RunColumn[] | null | undefined,
): string[] {
  const names =
    runColumns?.map((c) => c.name) ?? declared.filter((c) => !c.calculated).map((c) => c.name);
  let previous: string | null = null;
  for (const column of declared) {
    if (column.calculated) {
      names.splice(previous === null ? 0 : names.indexOf(previous) + 1, 0, column.name);
    } else if (!names.includes(column.name)) {
      continue;
    }
    previous = column.name;
  }
  return names;
}

/**
 * Grid columns of an action's results, in the run's order (declared first, then inferred), else
 * the action's declared order. Values come from each row's `data`, so a result column called `row`
 * or `id` keeps its own values. A declared `calculated` column is an AG Grid calculated column,
 * placed after the declared column before it. Declared settings are AG Grid `initial*` settings, so
 * a restored column state wins over them.
 */
export function buildActionColumnDefs(
  declaredColumns: readonly CatalogueColumn[] | null | undefined,
  runColumns: readonly RunColumn[] | null | undefined,
): ColDef[] {
  const declared = declaredColumns ?? [];
  const byName = new Map(declared.map((c) => [c.name, c]));
  return columnNames(declared, runColumns).map((name) => {
    const column = byName.get(name);
    return {
      colId: name,
      headerName: column?.title ?? name,
      ...(column?.calculated
        ? { calculatedExpression: column.calculated }
        : { valueGetter: (p) => (p.data as RunRow | undefined)?.data[name] }),
      ...(column && {
        initialHide: column.hidden,
        initialWidth: column.width ?? undefined,
        initialPinned: column.pinned ?? undefined,
        initialSort: column.sort ?? undefined,
        initialRowGroup: column.group,
      }),
    } satisfies ColDef;
  });
}
