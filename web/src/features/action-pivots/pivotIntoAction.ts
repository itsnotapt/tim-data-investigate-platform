import type { Notify } from '../../components/notifyContext';
import {
  resolvePivot,
  type CatalogueAction,
  type InstanceConnection,
  type PivotRows,
  type Preset,
} from '../../lib/api';
import { isApiError } from '../../lib/api/errors';
import { initialParams, stillMissing } from '../action-tab/paramValues';
import { pillLabels } from '../action-tab/queryParameters';
import { fromPivot, type OpeningParams, type Pivot } from '../action-tab/model';
import { titleColumns } from '../action-tab/titleTemplate';
import { useTabsStore, type TabsStore } from '../tabs';

interface ChildTabInput {
  /** The tab the rows are in; the child tab opens under it. */
  parentTabId: string;
  notify: Notify;
  /** Focuses a tab: the toast's Go to. */
  goTo: (tabId: string) => void;
  /** Runs the child tab when it needs nothing. */
  run: (tabId: string) => void;
  /** The pivot rows' `id`s, each `null` for a row without one; the child tab keeps them. */
  pivotRowIds: readonly (string | null)[];
  store?: TabsStore;
}

export interface PivotIntoActionInput extends ChildTabInput {
  action: CatalogueAction;
  /** The targets' values by column: the selected rows, or the right-clicked row. */
  rows: readonly Record<string, unknown>[];
  /** The right-clicked cell. */
  cell?: { column: string; value: unknown } | null;
  connections: readonly InstanceConnection[];
}

export interface PivotIntoPresetInput extends ChildTabInput {
  preset: Preset;
  action: CatalogueAction;
  /** The preset's params resolved from the rows (`presetPivot`). */
  resolved: OpeningParams;
  /** The targets' values by column, as in `PivotIntoActionInput`. */
  rows: readonly Record<string, unknown>[];
}

/**
 * Opens the child tab of `parentTabId` that `pivot` opens, in the background, and says so with Go
 * to. It runs at once when no param is missing, and otherwise waits for them, with the reasons.
 */
function openChildTab(
  { parentTabId, notify, goTo, run, pivotRowIds, store = useTabsStore }: ChildTabInput,
  pivot: Omit<Pivot, 'pivotRowIds'>,
): string {
  const { missing } = pivot;
  const content = fromPivot({ ...pivot, pivotRowIds });
  const { title } = content;
  const tabId = store.getState().createTab({ parentId: parentTabId, content });
  const needed = Object.keys(missing);
  const goToChild = { label: 'Go to', onClick: () => goTo(tabId) };
  if (needed.length > 0) {
    notify({
      message: `Opened ${title}: needs ${pillLabels(needed)}`,
      action: goToChild,
    });
  } else {
    run(tabId);
    notify({ message: `Running ${title}`, action: goToChild });
  }
  return tabId;
}

/** `rows` trimmed to `action`'s title columns, or none when it has none. */
function pivotRowsFor(
  action: CatalogueAction,
  rows: readonly Record<string, unknown>[],
): Record<string, unknown>[] | undefined {
  const columns = titleColumns(action.title);
  if (columns.length === 0) return undefined;
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([column]) => columns.includes(column))),
  );
}

/** The columns a pivot into `action` reads: its pivot columns and each param's `fromColumns`. */
function pivotInputColumns(action: CatalogueAction): Set<string> {
  return new Set([
    ...(action.pivot?.columns.flat() ?? []),
    ...action.params.flatMap((p) => p.fromColumns ?? []),
  ]);
}

/** The reason a failed resolve gives: the first field error, else the problem's detail. */
function failure(e: unknown): string {
  if (isApiError(e)) return Object.values(e.errors ?? {}).flat()[0] ?? e.detail;
  return e instanceof Error ? e.message : String(e);
}

/**
 * Pivots from `rows` into `action`: the server resolves its params from the rows, sent by value
 * and trimmed to the columns it reads. A child tab of `parentTabId` opens in the background. It
 * runs at once when no param is missing, and otherwise waits for them, with the reasons. A toast
 * says which, with Go to. Returns the child tab, or `null` when the server refused the pivot.
 */
export async function pivotIntoAction({
  action,
  rows,
  cell,
  connections,
  ...child
}: PivotIntoActionInput): Promise<string | null> {
  const columns = pivotInputColumns(action);
  const pivot: PivotRows = {
    rows: rows.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([column]) => columns.has(column))),
    ),
  };
  if (cell && columns.has(cell.column)) pivot.cell = cell;
  let resolved;
  try {
    resolved = await resolvePivot(action.key, pivot);
  } catch (e) {
    child.notify(`Couldn't pivot into ${action.name}: ${failure(e)}`);
    return null;
  }
  const params = { ...initialParams(action, connections), ...resolved.params };
  const missing = Object.fromEntries(
    stillMissing(Object.fromEntries(resolved.missing.map((name) => [name, null])), params).map(
      (name) => [name, resolved.reasons[name] ?? null],
    ),
  );
  return openChildTab(child, { action, params, missing, pivotRows: pivotRowsFor(action, rows) });
}

/**
 * Pivots with `preset` of `action`, its params already resolved from the rows in the browser:
 * a child tab of `parentTabId`, titled with the preset's name and holding its id, opens in the
 * background as after `pivotIntoAction`. Returns the child tab.
 */
export function pivotIntoPreset({
  preset,
  action,
  resolved,
  rows,
  ...child
}: PivotIntoPresetInput): string {
  return openChildTab(child, {
    action,
    preset,
    ...resolved,
    pivotRows: pivotRowsFor(action, rows),
  });
}
