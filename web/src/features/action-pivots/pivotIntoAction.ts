import type { Notify } from '../../components/notifyContext';
import {
  resolvePivot,
  type CatalogueAction,
  type InstanceConnection,
  type PivotRows,
  type Preset,
} from '../../lib/api';
import { isApiError } from '../../lib/api/errors';
import { initialParams, paramTitles, stillMissing } from '../action-tab/paramValues';
import { useTabsStore, type TabsStore } from '../tabs';

interface ChildTabInput {
  /** The tab the rows are in; the child tab opens under it. */
  parentUuid: string;
  notify: Notify;
  /** Focuses a tab: the toast's Go to. */
  goTo: (uuid: string) => void;
  /** Runs the child tab when it needs nothing. */
  run: (uuid: string) => void;
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
  resolved: Pick<ChildTab, 'params' | 'missing'>;
}

/** A child tab of an action to open: its title, params and the params it waits for. */
interface ChildTab {
  action: CatalogueAction;
  title: string;
  params: Record<string, unknown>;
  /** By param, why it is missing, if known. */
  missing: Record<string, string | null>;
  /** The preset it was opened from. */
  presetId?: string;
}

/**
 * Opens a child tab of `parentUuid` in the background, titled `title`, and says so with Go to.
 * It runs at once when no param is missing, and otherwise waits for them, with the reasons.
 */
function openChildTab(
  { parentUuid, notify, goTo, run, store = useTabsStore }: ChildTabInput,
  { action, title, params, missing, presetId }: ChildTab,
): string {
  const uuid = store.getState().createTab({
    componentName: 'ActionResult',
    parentUuid,
    title,
    params: { action: action.key, params, ...(presetId ? { presetId } : {}) },
  });
  const needed = Object.keys(missing);
  const goToChild = { label: 'Go to', onClick: () => goTo(uuid) };
  if (needed.length > 0) {
    store.getState().updateState(uuid, { pivotMissing: missing });
    notify({
      message: `Opened ${title}: needs ${paramTitles(action, needed)}`,
      action: goToChild,
    });
  } else {
    run(uuid);
    notify({ message: `Running ${title}`, action: goToChild });
  }
  return uuid;
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
 * and trimmed to the columns it reads. A child tab of `parentUuid` opens in the background. It
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
  return openChildTab(child, { action, title: action.name, params, missing });
}

/**
 * Pivots with `preset` of `action`, its params already resolved from the rows in the browser:
 * a child tab of `parentUuid`, titled with the preset's name and holding its id, opens in the
 * background as after `pivotIntoAction`. Returns the child tab.
 */
export function pivotIntoPreset({
  preset,
  action,
  resolved,
  ...child
}: PivotIntoPresetInput): string {
  return openChildTab(child, {
    action,
    title: preset.name,
    ...resolved,
    presetId: preset.presetId,
  });
}
