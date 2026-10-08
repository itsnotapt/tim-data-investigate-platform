import 'fake-indexeddb/auto';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../../lib/config/runtimeConfig';
import { rowResultsDao } from '../../lib/storage';
import { apiUrl, makeRun, queryRunHandlers, TEST_API } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { kusto, newTestStore } from '../../test/tabsTestUtils';
import { cloneTemplateTab, convertTemplateTab, runTemplateQuery } from './runTemplateQuery';

vi.mock('../../lib/api/client', async (orig) => {
  const m = await orig<typeof import('../../lib/api/client')>();
  return {
    ...m,
    getApiClient: () =>
      m.createApiClient({ baseUrl: TEST_API, getToken: () => Promise.resolve('t'), timeoutMs: 0 }),
  };
});

const server = setupMswServer();
const store = newTestStore();

const template = {
  uuid: 't1',
  menu: 'm',
  summary: 'Logons for {{user}}',
  path: 'p',
  cluster: 'https://{{region}}.kusto.windows.net',
  database: 'SecDb',
  query: 'T | where User == {{str user}}',
  params: { user: { default: '' }, region: { default: 'eu' } },
};

const mk = () =>
  store.getState().createTab({
    componentUuid: 'tpl',
    componentName: 'TemplateQueryResult',
    parentUuid: 'root',
    title: 'Logons',
    params: { inParams: { user: "o'neil", region: 'eu' }, queryTemplate: template },
    state: { editQuery: false },
  });

beforeEach(() => {
  store.reset();
  window.appConfig = {
    auth: { clientId: 'id', authority: 'https://login.example.com/t' },
    redirectUri: 'https://tim.example.com/blank.html',
    tagCluster: 'https://tags.kusto.windows.net',
  };
  resetConfigCache();
  store.getState().createTab(kusto('root'));
  mk();
});

const tab = (id = 'tpl') => store.getState().tabs[id]!;

describe('runTemplateQuery', () => {
  it('renders cluster/database/query, sends no time range and stores results', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(apiUrl('/api/kusto/query'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeRun({ status: 'completed', resultData: [{ a: 1 }] }));
      }),
    );
    const running = runTemplateQuery('tpl', { store });
    expect(tab().state.isExecuting).toBe(true);
    await running;
    expect(body).toMatchObject({ cluster: 'https://eu.kusto.windows.net', database: 'SecDb' });
    expect(body['query']).toContain('User == ');
    expect(body['startTime']).toBeUndefined();
    expect(body['endTime']).toBeUndefined();
    expect(tab().state).toMatchObject({ isExecuting: false, error: null, rowCount: 1 });
    expect(tab().rowDataTrigger).not.toBeNull();
    expect(await rowResultsDao.get('tpl')).toEqual([{ a: 1 }]);
  });

  it('stores an API error', async () => {
    server.use(...queryRunHandlers(makeRun({ status: 'error', mainError: 'Bad' })));
    await runTemplateQuery('tpl', { store });
    expect(tab().state).toMatchObject({ isExecuting: false, error: { message: 'Bad' } });
  });

  it('ignores non-template tabs', async () => {
    await runTemplateQuery('root', { store });
    expect(tab('root').state.isExecuting).toBe(false);
    expect(tab('root').rowDataTrigger).toBeNull();
  });
});

describe('cloneTemplateTab', () => {
  it('creates a sibling with the same parent, deep-copied params, not run', () => {
    const id = cloneTemplateTab('tpl', store)!;
    const copy = tab(id);
    expect(copy).toMatchObject({
      componentName: 'TemplateQueryResult',
      parentUuid: 'root',
      title: 'Copy of Logons',
      rowDataTrigger: null,
      state: { editQuery: true, isExecuting: false, rowCount: null },
    });
    if (copy.componentName !== 'TemplateQueryResult') throw new Error();
    expect(copy.params.inParams).toEqual(tab().params && (tab() as typeof copy).params.inParams);
    expect(copy.params.inParams).not.toBe((tab() as typeof copy).params.inParams);
  });
});

describe('convertTemplateTab', () => {
  it('produces a KustoQueryResult with the rendered KQL, keeping uuid and parent', () => {
    expect(convertTemplateTab('tpl', store)).toBe(true);
    const t = tab();
    expect(t.componentName).toBe('KustoQueryResult');
    expect(t.parentUuid).toBe('root');
    if (t.componentName !== 'KustoQueryResult') throw new Error();
    expect(t.params).toEqual({
      cluster: 'https://eu.kusto.windows.net',
      database: 'SecDb',
      query: expect.stringContaining('User == ') as string,
    });
    expect(t.params.query).toContain('neil');
    expect(t.state.error).toBeNull();
  });
});
