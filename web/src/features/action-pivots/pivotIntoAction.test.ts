import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, vi } from 'vitest';
import type { CatalogueAction, InstanceConnection, PivotResolution } from '../../lib/api';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { newTestStore } from '../../test/tabsTestUtils';
import type { NotifyOptions } from '../../components/notifyContext';
import { pivotIntoAction } from './pivotIntoAction';

const server = setupMswServer();

const SIGN_INS: CatalogueAction = {
  key: 'sign-ins',
  kind: 'query',
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
  return { store, parent, run, notified, goTo, pivot };
}

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
});
