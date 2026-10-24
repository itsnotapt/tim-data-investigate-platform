import type { ColDef } from 'ag-grid-community';
import type { CatalogueColumn, RunColumn, RunRow } from '../../lib/api';

/** A `tim:` column is one of TIM's own grid columns, never a result column. */
const isTimColumn = (name: string): boolean => name.startsWith('tim:');

/** A declared column the grid adds itself: a calculated column or one of TIM's own. */
const isAdded = (column: CatalogueColumn): boolean =>
  Boolean(column.calculated) || isTimColumn(column.name);

/**
 * The run's column names (else the declared ones), with each declared calculated or `tim:` column
 * after the declared column before it.
 */
function columnNames(
  declared: readonly CatalogueColumn[],
  runColumns: readonly RunColumn[] | null | undefined,
): string[] {
  const names =
    runColumns?.map((c) => c.name) ?? declared.filter((c) => !isAdded(c)).map((c) => c.name);
  let previous: string | null = null;
  for (const column of declared) {
    if (isAdded(column)) {
      names.splice(previous === null ? 0 : names.indexOf(previous) + 1, 0, column.name);
    } else if (!names.includes(column.name)) {
      continue;
    }
    previous = column.name;
  }
  return names;
}

/** A declared column's settings, as AG Grid `initial*` settings. */
const initialSettings = (column: CatalogueColumn) =>
  ({
    initialHide: column.hidden,
    initialWidth: column.width ?? undefined,
    initialPinned: column.pinned ?? undefined,
    initialSort: column.sort ?? undefined,
    initialRowGroup: column.group,
  }) satisfies ColDef;

/**
 * Grid columns of an action's results, in the run's order (declared first, then inferred), else
 * the action's declared order, with TIM's own columns `own`. Values come from each row's `data`, so
 * a result column called `row` or `id` keeps its own values. A declared `calculated` column is an
 * AG Grid calculated column, and a declared `tim:` column gives its settings to that column of
 * `own`: each is placed after the declared column before it, and the rest of `own` come last.
 * Declared settings are AG Grid `initial*` settings, so a restored column state wins over them.
 */
export function buildActionColumnDefs(
  declaredColumns: readonly CatalogueColumn[] | null | undefined,
  runColumns: readonly RunColumn[] | null | undefined,
  own: readonly ColDef[],
): ColDef[] {
  const declared = declaredColumns ?? [];
  const byName = new Map(declared.map((c) => [c.name, c]));
  const ownById = new Map(own.map((c) => [c.colId, c]));
  const names = columnNames(declared, runColumns).filter(
    (name) => !isTimColumn(name) || ownById.has(name),
  );
  const defs = names.map((name): ColDef => {
    const column = byName.get(name);
    const owned = ownById.get(name);
    if (owned) {
      if (!column) return owned;
      // TIM's own `width` and `hide` would win over the declared `initial*` settings.
      return {
        ...owned,
        width: undefined,
        hide: undefined,
        ...(column.title && { headerName: column.title }),
        ...initialSettings(column),
        initialWidth: column.width ?? owned.width,
      };
    }
    return {
      colId: name,
      headerName: column?.title ?? name,
      ...(column?.calculated
        ? { calculatedExpression: column.calculated }
        : { valueGetter: (p) => (p.data as RunRow | undefined)?.data[name] }),
      ...(column && initialSettings(column)),
    } satisfies ColDef;
  });
  return [...defs, ...own.filter((c) => !names.includes(c.colId ?? ''))];
}
