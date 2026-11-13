import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, vi } from 'vitest';
import type { CatalogueAction, InstanceConnection, PivotResolution, Preset } from '../../lib/api';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { newTestStore, tab } from '../../test/tabsTestUtils';
import type { NotifyOptions } from '../../components/notifyContext';
import { pivotIntoAction, pivotIntoPreset } from './pivotIntoAction';

const server = setupMswServer();

const SIGN_INS: CatalogueAction = {
  key: 'sign-ins',
  kind: 'query',
  actionFile: false,
  findPivotRows: false,
  name: 'Sign-ins',
  menuPath: ['Identity'],
  connections: [],
  params: [
    {
      name: 'connection',
      kind: 'connection',
      connectionType: 'kusto',
      required: true,
      many: false,
    },
    {
      name: 'users',
      kind: 'string',
      required: true,
      many: true,
      fromColumns: ['User', 'Upn'],
    },
    {
      name: 'result',
      kind: 'string',
      required: true,
      many: false,
      fromColumns: ['Result'],
    },
    { name: 'limit', kind: 'number', required: true, many: false, default: 10 },
  ],
  pivot: { rows: 'rows', columns: [['User', 'Upn']] },
};
const CONNECTIONS = [{ name: 'kusto-dev', type: 'kusto' }] as InstanceConnection[];

let bodies: unknown[] = [];
const resolving = (body: PivotResolution) =>
  http.post(apiUrl('/api/actions/sign-ins/resolve'), async ({ request }) => {
    bodies.push(await request.json());
    return HttpResponse.json(body);
  });

function setup(preset: Preset = FAILURES, action: CatalogueAction = SIGN_INS) {
  const store = newTestStore();
  const parent = store
    .getState()
    .createTab(tab('parent', null, { title: 'Parent', toRun: { action: 'parent' } }));
  const run = vi.fn();
  const notified: NotifyOptions[] = [];
  const goTo = vi.fn();
  const pivot = (
    rows: Record<string, unknown>[],
    cell?: { column: string; value: unknown },
    pivotRowIds: (string | null)[] = [],
  ) =>
    pivotIntoAction({
      action,
      parentTabId: parent,
      rows,
      cell,
      pivotRowIds,
      connections: CONNECTIONS,
      store,
      run,
      goTo,
      notify: (o) => notified.push(typeof o === 'string' ? { message: o } : o),
    });
  const pivotPreset = (
    resolved: {
      params: Record<string, unknown>;
      missing: Record<string, string | null>;
    },
    pivotRowIds: (string | null)[] = [],
    rows: Record<string, unknown>[] = [],
  ) =>
    pivotIntoPreset({
      preset,
      action,
      resolved,
      pivotRowIds,
      rows,
      parentTabId: parent,
      store,
      run,
      goTo,
      notify: (o) => notified.push(typeof o === 'string' ? { message: o } : o),
    });
  return { store, parent, run, notified, goTo, pivot, pivotPreset };
}

const FAILURES: Preset = {
  presetId: 'p-1',
  name: 'Failures of users',
  menuPath: [],
  owner: 'alice@example.com',
  visibility: 'shared',
  owned: false,
  hidden: false,
  action: 'sign-ins',
  params: {},
  inputs: [
    { name: 'users', source: 'param', fixed: false, showInTitle: true, fromColumns: ['User'] },
  ],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

describe('pivotIntoAction', () => {
  beforeEach(() => {
    configureTestApp();
    bodies = [];
  });
  afterEach(resetTestApp);

  it('sends the rows trimmed to the pivot columns, and runs a child tab that needs nothing', async () => {
    server.use(
      resolving({ params: { users: ['alice'], result: 'Failure' }, missing: [], reasons: {} }),
    );
    const { store, parent, run, notified, goTo, pivot } = setup();

    const tabId = await pivot([{ User: 'alice', Result: 'Failure', Secret: 's' }], {
      column: 'Secret',
      value: 's',
    });

    expect(bodies).toEqual([{ pivot: { rows: [{ User: 'alice', Result: 'Failure' }] } }]);
    const tab = store.getState().tabs[tabId!];
    expect(tab).toMatchObject({
      parentId: parent,
      title: 'Sign-ins',
      toRun: {
        action: 'sign-ins',
        params: { connection: 'kusto-dev', users: ['alice'], result: 'Failure', limit: 10 },
      },
    });
    expect(run).toHaveBeenCalledWith(tabId);
    expect(notified.map((n) => n.message)).toEqual(['Running Sign-ins']);
    notified[0]!.action!.onClick();
    expect(goTo).toHaveBeenCalledWith(tabId);
  });

  it('keeps the rows trimmed to the columns the action’s title names in the child tab', async () => {
    server.use(
      resolving({
        params: { users: ['alice', 'bob'], result: 'Failure' },
        missing: [],
        reasons: {},
      }),
    );
    const { store, pivot } = setup(FAILURES, {
      ...SIGN_INS,
      title: 'Sign-ins in {row.App} on {row.Host} for {users}',
    });

    const tabId = await pivot([
      { User: 'alice', Result: 'Failure', App: 'Teams', Secret: 's' },
      { User: 'bob', Result: 'Failure', App: 'Outlook', Host: 'BGIST-L' },
    ]);

    expect(store.getState().tabs[tabId!]?.toRun.pivotRows).toEqual([
      { App: 'Teams' },
      { App: 'Outlook', Host: 'BGIST-L' },
    ]);
  });

  it('keeps no rows in the child tab when the action’s title names no columns', async () => {
    server.use(
      resolving({ params: { users: ['alice'], result: 'Failure' }, missing: [], reasons: {} }),
    );
    const { store, pivot } = setup();

    const tabId = await pivot([{ User: 'alice', Result: 'Failure' }]);

    expect(store.getState().tabs[tabId!]?.toRun).not.toHaveProperty('pivotRows');
  });

  it('opens a child tab that waits for the params still missing, with their reasons', async () => {
    server.use(
      resolving({
        params: { users: ['alice', 'bob'] },
        missing: ['result', 'limit'],
        reasons: { result: 'The 2 selected rows have different result values' },
      }),
    );
    const { store, run, notified, pivot } = setup();

    const tabId = await pivot([{ User: 'alice' }, { User: 'bob' }], {
      column: 'User',
      value: 'bob',
    });

    expect(bodies).toEqual([
      {
        pivot: {
          rows: [{ User: 'alice' }, { User: 'bob' }],
          cell: { column: 'User', value: 'bob' },
        },
      },
    ]);
    const tab = store.getState().tabs[tabId!];
    expect(tab?.status.pivotMissing).toEqual({
      result: 'The 2 selected rows have different result values',
    });
    expect(run).not.toHaveBeenCalled();
    expect(notified.map((n) => n.message)).toEqual(['Opened Sign-ins: needs result']);
  });

  it('keeps the pivot rows’ ids on the child tab, null for a row without one', async () => {
    server.use(resolving({ params: { users: ['alice', 'bob'] }, missing: [], reasons: {} }));
    const { store, pivot } = setup();

    const tabId = await pivot([{ User: 'alice' }, { User: 'bob' }], undefined, ['e-1', null]);

    expect(store.getState().tabs[tabId!]?.toRun.pivotRowIds).toEqual(['e-1', null]);
  });

  it('says why when the server refuses the pivot, and opens no tab', async () => {
    server.use(
      http.post(apiUrl('/api/actions/sign-ins/resolve'), () =>
        problemResponse(422, { errors: { 'pivot.rows': ['At most 2 rows; 3 selected'] } }),
      ),
    );
    const { store, run, notified, pivot } = setup();

    expect(await pivot([{ User: 'a' }, { User: 'b' }, { User: 'c' }])).toBeNull();

    expect(Object.keys(store.getState().tabs)).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
    expect(notified.map((n) => n.message)).toEqual([
      "Couldn't pivot into Sign-ins: At most 2 rows; 3 selected",
    ]);
  });

  it('pivots with a preset into a child tab titled with its name and holding its id, which runs', () => {
    const { store, parent, run, notified, goTo, pivotPreset } = setup();

    const tabId = pivotPreset({
      params: { connection: 'kusto-dev', users: ['alice'], result: 'Failure', limit: 10 },
      missing: {},
    });

    expect(bodies).toEqual([]);
    expect(store.getState().tabs[tabId]).toMatchObject({
      parentId: parent,
      title: 'Failures of users',
      toRun: {
        action: 'sign-ins',
        params: { connection: 'kusto-dev', users: ['alice'], result: 'Failure', limit: 10 },
        presetId: 'p-1',
        titleInputs: [{ source: 'param', name: 'users' }],
      },
    });
    expect(run).toHaveBeenCalledWith(tabId);
    expect(notified.map((n) => n.message)).toEqual(['Running Failures of users']);
    notified[0]!.action!.onClick();
    expect(goTo).toHaveBeenCalledWith(tabId);
  });

  it('keeps the rows trimmed to the action’s title columns in a preset pivot', () => {
    const { store, pivotPreset } = setup(FAILURES, {
      ...SIGN_INS,
      title: 'Sign-ins in {row.App}',
    });

    const tabId = pivotPreset(
      {
        params: { connection: 'kusto-dev', users: ['alice'], result: 'Failure', limit: 10 },
        missing: {},
      },
      [],
      [{ User: 'alice', App: 'Teams' }],
    );

    expect(store.getState().tabs[tabId]?.toRun.pivotRows).toEqual([{ App: 'Teams' }]);
  });

  it('opens a preset pivot with the preset’s Id column', () => {
    const { store, pivotPreset } = setup({ ...FAILURES, idColumn: 'Host' });

    const tabId = pivotPreset({ params: { connection: 'kusto-dev' }, missing: {} });

    expect(store.getState().tabs[tabId]?.grid.idColumn).toBe('Host');
  });

  it('keeps the pivot rows’ ids on a preset pivot’s child tab, beside the preset’s Id column', () => {
    const { store, pivotPreset } = setup({ ...FAILURES, idColumn: 'Host' });

    const tabId = pivotPreset({ params: { connection: 'kusto-dev' }, missing: {} }, [null, 'e-2']);

    expect(store.getState().tabs[tabId]).toMatchObject({
      grid: { idColumn: 'Host' },
      toRun: { pivotRowIds: [null, 'e-2'] },
    });
  });

  it('opens a preset pivot that misses a value as a child tab waiting for it', () => {
    const { store, run, notified, pivotPreset } = setup();

    const tabId = pivotPreset({ params: { connection: 'kusto-dev' }, missing: { users: null } });

    expect(store.getState().tabs[tabId]?.status.pivotMissing).toEqual({ users: null });
    expect(run).not.toHaveBeenCalled();
    expect(notified.map((n) => n.message)).toEqual(['Opened Failures of users: needs users']);
  });

  it('names a query parameter a preset pivot misses by its name', () => {
    const { store, parent, run, notified, goTo } = setup();
    const runKql: CatalogueAction = {
      ...SIGN_INS,
      key: 'tim.run_kql',
      name: 'Run KQL',
      params: [
        { name: 'kql', kind: 'kql', required: true, many: false },
        {
          name: 'parameters',
          kind: 'json',
          required: false,
          many: false,
        },
      ],
      pivot: null,
    };

    pivotIntoPreset({
      preset: { ...FAILURES, name: 'Sign-ins by user', action: 'tim.run_kql' },
      action: runKql,
      resolved: {
        params: {
          kql: 'SigninLogs | where UserPrincipalName == Upn',
          parameters: [{ name: 'Upn', type: 'string', value: null }],
        },
        missing: { 'parameters.Upn': null },
      },
      pivotRowIds: [],
      rows: [],
      parentTabId: parent,
      store,
      run,
      goTo,
      notify: (o) => notified.push(typeof o === 'string' ? { message: o } : o),
    });

    expect(notified.map((n) => n.message)).toEqual(['Opened Sign-ins by user: needs Upn']);
  });
});
