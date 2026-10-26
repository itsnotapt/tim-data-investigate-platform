import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, vi } from 'vitest';
import type { CatalogueAction, InstanceConnection, PivotResolution, Preset } from '../../lib/api';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { newTestStore } from '../../test/tabsTestUtils';
import type { NotifyOptions } from '../../components/notifyContext';
import { pivotIntoAction, pivotIntoPreset } from './pivotIntoAction';

const server = setupMswServer();

const SIGN_INS: CatalogueAction = {
  key: 'sign-ins',
  kind: 'query',
  actionFile: false,
  name: 'Sign-ins',
  menuPath: ['Identity'],
  connections: [],
  params: [
    {
      name: 'connection',
      title: 'Connection',
      kind: 'connection',
      connectionType: 'kusto',
      required: true,
      many: false,
    },
    {
      name: 'users',
      title: 'Users',
      kind: 'string',
      required: true,
      many: true,
      fromColumns: ['User', 'Upn'],
    },
    {
      name: 'result',
      title: 'Result',
      kind: 'string',
      required: true,
      many: false,
      fromColumns: ['Result'],
    },
    { name: 'limit', title: 'Limit', kind: 'number', required: true, many: false, default: 10 },
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

function setup() {
  const store = newTestStore();
  const parent = store.getState().createTab({
    componentName: 'ActionResult',
    parentUuid: null,
    title: 'Parent',
    params: { action: 'parent', params: {} },
  });
  const run = vi.fn();
  const notified: NotifyOptions[] = [];
  const goTo = vi.fn();
  const pivot = (rows: Record<string, unknown>[], cell?: { column: string; value: unknown }) =>
    pivotIntoAction({
      action: SIGN_INS,
      parentUuid: parent,
      rows,
      cell,
      connections: CONNECTIONS,
      store,
      run,
      goTo,
      notify: (o) => notified.push(typeof o === 'string' ? { message: o } : o),
    });
  const pivotPreset = (resolved: {
    params: Record<string, unknown>;
    missing: Record<string, string | null>;
  }) =>
    pivotIntoPreset({
      preset: FAILURES,
      action: SIGN_INS,
      resolved,
      parentUuid: parent,
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
  inputs: [{ name: 'users', source: 'param', fixed: false, fromColumns: ['User'] }],
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

    const uuid = await pivot([{ User: 'alice', Result: 'Failure', Secret: 's' }], {
      column: 'Secret',
      value: 's',
    });

    expect(bodies).toEqual([{ pivot: { rows: [{ User: 'alice', Result: 'Failure' }] } }]);
    const tab = store.getState().tabs[uuid!];
    expect(tab).toMatchObject({
      componentName: 'ActionResult',
      parentUuid: parent,
      title: 'Sign-ins',
      params: {
        action: 'sign-ins',
        params: { connection: 'kusto-dev', users: ['alice'], result: 'Failure', limit: 10 },
      },
    });
    expect(run).toHaveBeenCalledWith(uuid);
    expect(notified.map((n) => n.message)).toEqual(['Running Sign-ins']);
    notified[0]!.action!.onClick();
    expect(goTo).toHaveBeenCalledWith(uuid);
  });

  it('opens a child tab that waits for the params still missing, with their reasons', async () => {
    server.use(
      resolving({
        params: { users: ['alice', 'bob'] },
        missing: ['result', 'limit'],
        reasons: { result: 'The 2 selected rows have different Result values' },
      }),
    );
    const { store, run, notified, pivot } = setup();

    const uuid = await pivot([{ User: 'alice' }, { User: 'bob' }], {
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
    const tab = store.getState().tabs[uuid!];
    expect(tab?.state.pivotMissing).toEqual({
      result: 'The 2 selected rows have different Result values',
    });
    expect(run).not.toHaveBeenCalled();
    expect(notified.map((n) => n.message)).toEqual(['Opened Sign-ins: needs Result']);
  });

  it('pivots on a whole number beyond 2^53 exactly, both ways', async () => {
    let sent = '';
    server.use(
      http.post(apiUrl('/api/actions/sign-ins/resolve'), async ({ request }) => {
        sent = await request.text();
        return new HttpResponse(
          '{"params":{"users":[12345678901234567890],"result":"Failure"},"missing":[],"reasons":{}}',
          { headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
    const { store, pivot } = setup();

    const uuid = await pivot([{ User: 12345678901234567890n, Result: 'Failure' }]);

    expect(sent).toBe('{"pivot":{"rows":[{"User":12345678901234567890,"Result":"Failure"}]}}');
    expect(store.getState().tabs[uuid!]?.params.params).toMatchObject({
      users: [12345678901234567890n],
    });
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

    const uuid = pivotPreset({
      params: { connection: 'kusto-dev', users: ['alice'], result: 'Failure', limit: 10 },
      missing: {},
    });

    expect(bodies).toEqual([]);
    expect(store.getState().tabs[uuid]).toMatchObject({
      componentName: 'ActionResult',
      parentUuid: parent,
      title: 'Failures of users',
      params: {
        action: 'sign-ins',
        params: { connection: 'kusto-dev', users: ['alice'], result: 'Failure', limit: 10 },
        presetId: 'p-1',
      },
    });
    expect(run).toHaveBeenCalledWith(uuid);
    expect(notified.map((n) => n.message)).toEqual(['Running Failures of users']);
    notified[0]!.action!.onClick();
    expect(goTo).toHaveBeenCalledWith(uuid);
  });

  it('opens a preset pivot that misses a value as a child tab waiting for it', () => {
    const { store, run, notified, pivotPreset } = setup();

    const uuid = pivotPreset({ params: { connection: 'kusto-dev' }, missing: { users: null } });

    expect(store.getState().tabs[uuid]?.state.pivotMissing).toEqual({ users: null });
    expect(run).not.toHaveBeenCalled();
    expect(notified.map((n) => n.message)).toEqual(['Opened Failures of users: needs Users']);
  });

  it('names a query parameter a preset pivot misses by its name', () => {
    const { store, parent, run, notified, goTo } = setup();
    const runKql: CatalogueAction = {
      ...SIGN_INS,
      key: 'tim.run_kql',
      name: 'Run KQL',
      params: [
        { name: 'kql', title: 'Query', kind: 'kql', required: true, many: false },
        {
          name: 'parameters',
          title: 'Query parameters',
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
      parentUuid: parent,
      store,
      run,
      goTo,
      notify: (o) => notified.push(typeof o === 'string' ? { message: o } : o),
    });

    expect(notified.map((n) => n.message)).toEqual(['Opened Sign-ins by user: needs Upn']);
  });
});
