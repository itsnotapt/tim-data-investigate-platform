import { z } from 'zod';
import { displayComponentsDao, type DisplayComponent } from '../../lib/storage';
import { useTabsStore } from '../tabs';

const storedError = z.object({ message: z.string(), code: z.string().optional() });

const tabState = z.looseObject({
  isVisited: z.boolean().default(false),
  error: storedError.nullable().default(null),
  rowCount: z.number().nullable().default(null),
  isExecuting: z.boolean().default(false),
});

const base = {
  componentUuid: z.string().min(1),
  title: z.string(),
  parentUuid: z.string().nullable(),
  rowDataTrigger: z.number().nullable().default(null),
  displayComponentIndex: z.number().default(0),
  state: tabState,
};

const tabSchema = z.discriminatedUnion('componentName', [
  z.looseObject({
    ...base,
    componentName: z.literal('KustoQueryResult'),
    params: z.looseObject({ query: z.string(), cluster: z.string(), database: z.string() }),
  }),
  z.looseObject({
    ...base,
    componentName: z.literal('TemplateQueryResult'),
    params: z.looseObject({
      inParams: z.record(z.string(), z.unknown()),
      queryTemplate: z.record(z.string(), z.unknown()),
    }),
  }),
]);

/** Payload: a JSON array of stored tabs (no row results). */
const exportSchema = z.array(tabSchema);

export type ParseResult = { ok: true; tabs: DisplayComponent[] } | { ok: false; message: string };

export function parseImport(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, message: 'Not valid JSON.' };
  }
  const result = exportSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join('.') ?? '';
    return {
      ok: false,
      message: `Invalid settings${where ? ` at ${where}` : ''}: ${issue?.message ?? ''}`,
    };
  }
  const tabs = result.data.map((t) => ({
    ...t,
    // Nothing can be running after an import.
    state: { ...t.state, isExecuting: false },
  })) as DisplayComponent[];
  return { ok: true, tabs };
}

/** This app's tabs from IndexedDB, in load order, as JSON. */
export async function exportTabsJson(): Promise<string> {
  await useTabsStore.getState().flush();
  const tabs = await displayComponentsDao.getAll();
  tabs.sort((a, b) => a.displayComponentIndex - b.displayComponentIndex);
  return JSON.stringify(tabs.map(stripServerFields));
}

const SERVER_ONLY = ['createdBy', 'updatedBy', 'updated'];

/** Template tabs embed the server template; drop author emails and timestamps. */
function stripServerFields(tab: DisplayComponent): DisplayComponent {
  const params = tab.params as { queryTemplate?: Record<string, unknown> } | undefined;
  const qt = params?.queryTemplate;
  if (tab.componentName !== 'TemplateQueryResult' || !qt) return tab;
  const clean = Object.fromEntries(Object.entries(qt).filter(([k]) => !SERVER_ONLY.includes(k)));
  return { ...tab, params: { ...params, queryTemplate: clean } } as DisplayComponent;
}

/** Writes the tabs (same uuid overwrites) and reloads the tab store in place. */
export async function importTabs(tabs: DisplayComponent[]): Promise<void> {
  const store = useTabsStore.getState();
  await store.flush();
  // Keep the imported relative order, after everything already present.
  const existing = await displayComponentsDao.getAll();
  const base = existing.reduce((m, t) => Math.max(m, t.displayComponentIndex + 1), 0);
  const sorted = [...tabs].sort((a, b) => a.displayComponentIndex - b.displayComponentIndex);
  for (const [i, tab] of sorted.entries()) {
    await displayComponentsDao.put({ ...tab, displayComponentIndex: base + i });
  }
  await store.load();
  const { loadError } = useTabsStore.getState();
  if (loadError) throw new Error(loadError);
}
