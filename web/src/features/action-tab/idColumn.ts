import type { CatalogueAction } from '../../lib/api';
import type { DisplayComponentState } from '../../lib/storage/types';
import { useTabsStore, type TabsStore } from '../tabs';
import { setPill } from './queryParameters';

/** The param of Run KQL, Run SQL and `dev_json` that names the Id column. */
export const ID_COLUMN_PARAM = 'idColumn';

/** A param's value as a column name, else `null`. */
export const columnName = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** Whether the action takes its Id column from an `idColumn` param. */
export const takesIdColumn = (action: CatalogueAction | undefined) =>
  action?.params.some((p) => p.name === ID_COLUMN_PARAM) ?? false;

/** The Id column a run's results open with: the `idColumn` param of its `params`, else the action's. */
export function startingIdColumn(
  action: CatalogueAction | undefined,
  params: Record<string, unknown> | null | undefined,
): string | null {
  return columnName(params?.[ID_COLUMN_PARAM]) ?? action?.idColumn ?? null;
}

/** The Id column of an action tab's results: the one the analyst switched to, else the run's. */
export function resultsIdColumn(
  action: CatalogueAction | undefined,
  state: DisplayComponentState,
): string | null {
  return state.idColumn !== undefined ? state.idColumn : startingIdColumn(action, state.runParams);
}

/**
 * The Id column a share link to the tab's results carries: the tab's, when it isn't the one the
 * run's results start with, else `null`.
 */
export function shareLinkIdColumn(
  action: CatalogueAction | undefined,
  state: DisplayComponentState,
): string | null {
  const idColumn = resultsIdColumn(action, state);
  return idColumn !== startingIdColumn(action, state.run?.params ?? state.runParams)
    ? idColumn
    : null;
}

/**
 * Switches the Id column of an action tab's results to `column`. An `idColumn` param takes it too,
 * as if the last run had, so the next run keeps it and the params don't count as edited.
 */
export function switchIdColumn(
  uuid: string,
  action: CatalogueAction | undefined,
  column: string | null,
  store: TabsStore = useTabsStore,
): void {
  const tab = store.getState().tabs[uuid];
  if (tab?.componentName !== 'ActionResult') return;
  if (!takesIdColumn(action)) {
    store.getState().updateState(uuid, { idColumn: column });
    return;
  }
  const value = column ?? undefined;
  store.getState().updateParams(uuid, {
    params: setPill(tab.params.params, ID_COLUMN_PARAM, value),
  });
  store.getState().updateState(uuid, {
    idColumn: column,
    runParams: setPill(tab.state.runParams ?? {}, ID_COLUMN_PARAM, value),
  });
}

/** What the toast says after switching the Id column to `column`. */
export const switchedText = (column: string | null) =>
  column === null
    ? 'Id column cleared: the rows have no id'
    : `Id column set to ${column}: labels now follow ${column}`;
