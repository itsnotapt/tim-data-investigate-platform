import { buildCluster, buildQuery, type QueryTemplate } from '../../lib/kql-templates';
import { runTabQuery, type RunPipelineOptions } from '../kusto-query/runPipeline';
import { useTabsStore, type TabsStore } from '../tabs';
import { getTabTemplate, type TemplateQueryTab } from '../tabs/types';

/** The template's (constant) database. */
function templateDatabase(tab: TemplateQueryTab): string {
  const db = tab.params.queryTemplate['database'];
  return typeof db === 'string' ? db : '';
}

/** Renders a template tab's cluster / database / query from its saved params. */
function renderTemplateTab(tab: TemplateQueryTab): {
  cluster: string;
  database: string;
  query: string;
} {
  const template: QueryTemplate = getTabTemplate(tab);
  const params = tab.params.inParams;
  return {
    cluster: buildCluster(template, params),
    database: templateDatabase(tab),
    query: buildQuery(template, params),
  };
}

/**
 * Runs a template tab: renders cluster and query
 * from the saved params and runs them through the shared pipeline WITHOUT a time range.
 * A rendering failure is stored as the tab's error. Never rejects.
 */
export async function runTemplateQuery(
  uuid: string,
  options: RunPipelineOptions = {},
): Promise<void> {
  const store: TabsStore = options.store ?? useTabsStore;
  const tab = store.getState().tabs[uuid];
  if (tab?.componentName !== 'TemplateQueryResult') return;
  let rendered;
  try {
    rendered = renderTemplateTab(tab);
  } catch (e) {
    store.getState().updateState(uuid, { isExecuting: false, error: e });
    return;
  }
  await runTabQuery(uuid, rendered, { ...options, store });
}

/** Clone as a sibling (same parent) titled "Copy of <title>"; edit mode, not auto-run. */
export function cloneTemplateTab(uuid: string, store: TabsStore = useTabsStore): string | null {
  const tab = store.getState().tabs[uuid];
  if (tab?.componentName !== 'TemplateQueryResult') return null;
  // Deep clone (objects/arrays in params).
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  return store.getState().createTab({
    componentName: 'TemplateQueryResult',
    parentUuid: tab.parentUuid,
    title: `Copy of ${tab.title}`,
    params: {
      inParams: clone(tab.params.inParams),
      queryTemplate: clone(tab.params.queryTemplate),
    },
    state: { editQuery: true },
  });
}

/** Convert to a `KustoQueryResult` with the rendered KQL. */
export function convertTemplateTab(uuid: string, store: TabsStore = useTabsStore): boolean {
  const tab = store.getState().tabs[uuid];
  if (tab?.componentName !== 'TemplateQueryResult') return false;
  store.getState().convertToKusto(uuid, renderTemplateTab(tab));
  return true;
}
