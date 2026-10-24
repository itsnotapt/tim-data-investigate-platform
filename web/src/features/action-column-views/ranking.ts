import type { ColumnView } from '../../lib/api';
import { isGridColumn, type ColumnViewState } from './columnViewState';

/** The tab a column view is picked for: its action, and the preset it was opened from. */
export interface ColumnViewScope {
  action: string;
  presetId?: string;
}

/** The scope of an action tab with these params; `presetId` is left out when there is none. */
export const scopeOf = ({ action, presetId }: ColumnViewScope): ColumnViewScope =>
  presetId ? { action, presetId } : { action };

export interface RankedColumnView {
  view: ColumnView;
  /** How many of the tab's columns the column view orders. */
  matching: number;
  /** How many columns the tab has, without TIM's and AG Grid's own. */
  total: number;
}

export interface RankedColumnViews {
  /** Column views saved from this preset, or for an action tab from this action without one. */
  own: ColumnView[];
  /** The other column views with at least one of the tab's columns, most matching first. */
  others: RankedColumnView[];
}

const isResultColumn = (colId: string) => !colId.startsWith('tim:') && !isGridColumn(colId);

const byName = (a: ColumnView, b: ColumnView) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Whether `view` was saved from the tab's preset, or from its action if the tab has none. */
export const isSavedFrom = (view: ColumnView, scope: ColumnViewScope) =>
  scope.presetId
    ? view.savedFrom.presetId === scope.presetId
    : view.savedFrom.action === scope.action && !view.savedFrom.presetId;

/**
 * The column views to offer a tab whose grid has `columnIds`, in the order the Views panel lists
 * them. Hidden column views are left out unless `showHidden`.
 */
export function rankColumnViews(
  views: ColumnView[],
  scope: ColumnViewScope,
  columnIds: string[],
  { showHidden = false }: { showHidden?: boolean } = {},
): RankedColumnViews {
  const columns = new Set(columnIds.filter(isResultColumn));
  const shown = views.filter((v) => showHidden || !v.hidden);
  const own = shown.filter((v) => isSavedFrom(v, scope)).sort(byName);
  const others = shown
    .filter((v) => !isSavedFrom(v, scope))
    .map((view) => {
      const order = (view.state as ColumnViewState).columnOrder?.orderedColIds ?? [];
      return {
        view,
        matching: new Set(order.filter((c) => columns.has(c))).size,
        total: columns.size,
      };
    })
    .filter((r) => r.matching > 0)
    .sort((a, b) => b.matching - a.matching || byName(a.view, b.view));
  return { own, others };
}
