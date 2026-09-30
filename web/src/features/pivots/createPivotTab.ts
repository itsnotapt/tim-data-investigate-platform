import type { NavigateFunction } from 'react-router';
import { buildParams, buildSummary, isDataComplete } from '../../lib/kql-templates';
import type { QueryTemplate, Row } from '../../lib/kql-templates';
import { runTemplateQuery } from '../template-query/runTemplateQuery';
import { useTabsStore, type TabsStore } from '../tabs';

export interface CreatePivotTabOptions {
  /** The template to pivot with (snapshotted into the new tab). */
  template: QueryTemplate;
  /** Clicked row. */
  row: Row;
  /** Selected rows; the clicked row when none are selected. */
  selectedRows?: Row[];
  /** The tab the grid belongs to; the new tab becomes its child. */
  parentUuid: string;
  /** False when Shift was held: the child opens in edit mode and is not run. */
  autoExecute?: boolean;
  navigate?: NavigateFunction;
  store?: TabsStore;
  run?: (uuid: string) => Promise<void>;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Legacy `createNewTemplateQueryComponent` for a grid pivot (displayComponent.js:145): params from
 * the clicked / selected rows, a child `TemplateQueryResult`, edit mode unless it is run
 * (`!autoExecute || !isDataComplete`), run when `autoExecute && isDataComplete`, and navigate to it
 * only when the data is incomplete (the user has to fill it in). Returns the new tab uuid.
 */
export async function createPivotTab({
  template,
  row,
  selectedRows = [],
  parentUuid,
  autoExecute = true,
  navigate,
  store = useTabsStore,
  run = (uuid) => runTemplateQuery(uuid, { store }),
}: CreatePivotTabOptions): Promise<string> {
  const rows = selectedRows.length > 0 ? selectedRows : [row];
  const params = clone(buildParams(template, row, rows));
  const complete = isDataComplete(template, params);
  const uuid = store.getState().createTab({
    componentName: 'TemplateQueryResult',
    parentUuid,
    title: buildSummary(template, params),
    params: {
      inParams: params,
      queryTemplate: clone(template) as unknown as Record<string, unknown>,
    },
    state: { editQuery: !autoExecute || !complete },
  });
  if (autoExecute && complete) await run(uuid);
  if (!complete) void navigate?.(`/view/${uuid}`);
  return uuid;
}
