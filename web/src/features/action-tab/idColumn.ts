import type { CatalogueAction } from '../../lib/api';
import type { DisplayComponentState } from '../../lib/storage/types';

/** The action's Id column: the `id` of its action file. */
export const actionIdColumn = (action: CatalogueAction | undefined): string | null =>
  action?.idColumn ?? null;

/** The Id column of an action tab's results: the one the analyst switched to, else the action's. */
export function resultsIdColumn(
  action: CatalogueAction | undefined,
  state: DisplayComponentState,
): string | null {
  return state.idColumn !== undefined ? state.idColumn : actionIdColumn(action);
}

/**
 * The Id column a share link to the tab's results carries: the tab's, when it isn't the action's,
 * else `null`.
 */
export function shareLinkIdColumn(
  action: CatalogueAction | undefined,
  state: DisplayComponentState,
): string | null {
  const idColumn = resultsIdColumn(action, state);
  return idColumn !== actionIdColumn(action) ? idColumn : null;
}

/** What the toast says after switching the Id column to `column`. */
export const switchedText = (column: string | null) =>
  column === null
    ? 'Id column cleared: the rows have no id'
    : `Id column set to ${column}: labels now follow ${column}`;
