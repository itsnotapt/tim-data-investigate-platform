import type { CatalogueAction, InstanceConnection, Preset } from '../../lib/api';
import { presetPivot } from './presetPivot';

const SIGN_INS: CatalogueAction = {
  key: 'sign-ins',
  actionFile: false,
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
  pivot: null,
};
const CONNECTIONS = [{ name: 'kusto-dev', type: 'kusto' }] as InstanceConnection[];

const RUN_KQL: CatalogueAction = {
  key: 'tim.run_kql',
  actionFile: true,
  kind: 'query',
  name: 'Run KQL',
  menuPath: [],
  connections: [],
  params: [
    { name: 'kql', title: 'Query', kind: 'kql', required: true, many: false },
    { name: 'parameters', title: 'Query parameters', kind: 'json', required: false, many: false },
  ],
  pivot: null,
};

const preset = (inputs: Preset['inputs'], params: Preset['params'] = {}): Preset => ({
  presetId: 'p-1',
  name: 'Failed sign-ins',
  menuPath: ['Mine'],
  owner: 'alice@example.com',
  visibility: 'shared',
  owned: true,
  hidden: false,
  action: 'sign-ins',
  params,
  inputs,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
});

const RESULT_FROM_ROW = preset(
  [{ name: 'result', source: 'param', fixed: false, fromColumns: ['Status', 'Result'] }],
  { limit: 5, users: ['alice'] },
);

const pivot = (p: Preset, rows: Record<string, unknown>[]) =>
  presetPivot(p, SIGN_INS, rows, CONNECTIONS);

describe('presetPivot', () => {
  it("resolves a From row input from the first of its columns the rows have, over the preset's params and the action's defaults", () => {
    expect(pivot(RESULT_FROM_ROW, [{ Result: 'Failure', User: 'alice' }])).toEqual({
      params: { connection: 'kusto-dev', limit: 5, users: ['alice'], result: 'Failure' },
      missing: {},
    });
    expect(pivot(RESULT_FROM_ROW, [{ Status: 'Locked', Result: 'Failure' }])).toEqual({
      params: { connection: 'kusto-dev', limit: 5, users: ['alice'], result: 'Locked' },
      missing: {},
    });
  });

  it('gives a many-valued input the distinct values of the rows, and a single-valued one the value they agree on', () => {
    const both = preset([
      { name: 'users', source: 'param', fixed: false, fromColumns: ['Upn', 'User'] },
      { name: 'result', source: 'param', fixed: false, fromColumns: ['Result'] },
    ]);
    const rows = [
      { User: 'alice', Result: 'Failure' },
      { Upn: 'bob@example.com', User: 'bob', Result: 'Failure' },
      { User: 'alice', Result: 'Failure' },
    ];
    expect(pivot(both, rows)).toEqual({
      params: {
        connection: 'kusto-dev',
        limit: 10,
        users: ['alice', 'bob@example.com'],
        result: 'Failure',
      },
      missing: {},
    });
  });

  it("is disabled when the rows disagree on a single-valued input's value, saying which", () => {
    expect(pivot(RESULT_FROM_ROW, [{ Result: 'Failure' }, { Result: 'Success' }])).toEqual({
      disabled: 'The 2 selected rows have different Result values',
    });
  });

  it('leaves an input that no row has a value for missing, so the tab waits for it', () => {
    const both = preset([
      { name: 'users', source: 'param', fixed: false, fromColumns: ['User'] },
      { name: 'result', source: 'param', fixed: false, fromColumns: ['Result'] },
    ]);
    expect(pivot(both, [{ User: '', Result: null }])).toEqual({
      params: { connection: 'kusto-dev', limit: 10 },
      missing: { users: null, result: null },
    });
  });

  it("doesn't pivot unless every From row input has columns that every row has one of", () => {
    const rows = [{ User: 'alice', Result: 'Failure' }];
    const bookmark = preset([{ name: 'result', source: 'param', fixed: true, value: 'Failure' }]);
    const asks = preset([
      { name: 'users', source: 'param', fixed: false, fromColumns: ['User'] },
      { name: 'result', source: 'param', fixed: false, fromColumns: [] },
    ]);
    expect(pivot(bookmark, rows)).toBeNull();
    expect(pivot(preset(undefined), rows)).toBeNull();
    expect(pivot(asks, rows)).toBeNull();
    expect(pivot(RESULT_FROM_ROW, [{ Result: 'Failure' }, { User: 'bob' }])).toBeNull();
  });

  it('waits, as after a pivot into the action, only for the required params that are still unset', () => {
    const optional: CatalogueAction = {
      ...SIGN_INS,
      params: [
        ...SIGN_INS.params.map((p) => (p.name === 'users' ? { ...p, required: false } : p)),
        { name: 'region', title: 'Region', kind: 'string', required: true, many: false },
      ],
    };
    const both = preset([
      { name: 'users', source: 'param', fixed: false, fromColumns: ['User'] },
      { name: 'result', source: 'param', fixed: false, fromColumns: ['Result'] },
    ]);
    expect(presetPivot(both, optional, [{ User: null, Result: 'Failure' }], CONNECTIONS)).toEqual({
      params: { connection: 'kusto-dev', limit: 10, result: 'Failure' },
      missing: { region: null },
    });
  });

  it('matches only columns the rows have, not properties every object has', () => {
    const odd = preset([
      { name: 'result', source: 'param', fixed: false, fromColumns: ['constructor'] },
    ]);
    expect(pivot(odd, [{ Result: 'Failure' }])).toBeNull();
  });

  describe('with query parameters', () => {
    const signIns = preset(
      [
        {
          name: 'Upn',
          source: 'queryParameter',
          type: 'string',
          fixed: false,
          fromColumns: ['UserPrincipalName', 'Upn'],
        },
        {
          name: 'Since',
          source: 'queryParameter',
          type: 'datetime',
          fixed: true,
          value: '2026-10-01T00:00:00Z',
        },
        {
          name: 'Hosts',
          source: 'queryParameter',
          type: 'dynamic',
          fixed: false,
          fromColumns: ['Host'],
        },
      ],
      { kql: 'SigninLogs | where UserPrincipalName == Upn and Host in (Hosts)' },
    );
    const kqlPivot = (rows: Record<string, unknown>[]) =>
      presetPivot({ ...signIns, action: 'tim.run_kql' }, RUN_KQL, rows, CONNECTIONS);

    it('fills each From row query parameter: a dynamic one with the distinct values, any other with the value the rows agree on', () => {
      const rows = [
        { UserPrincipalName: 'alice@example.com', Host: 'web-1' },
        { Upn: 'alice@example.com', Host: 'web-2' },
        { UserPrincipalName: 'alice@example.com', Host: 'web-1' },
      ];
      expect(kqlPivot(rows)).toEqual({
        params: {
          kql: 'SigninLogs | where UserPrincipalName == Upn and Host in (Hosts)',
          parameters: [
            { name: 'Upn', type: 'string', value: 'alice@example.com' },
            { name: 'Since', type: 'datetime', value: '2026-10-01T00:00:00Z' },
            { name: 'Hosts', type: 'dynamic', value: ['web-1', 'web-2'] },
          ],
        },
        missing: {},
      });
    });

    it('is disabled when the rows disagree on a query parameter, and waits for one no row has a value for', () => {
      expect(
        kqlPivot([
          { Upn: 'alice@example.com', Host: 'web-1' },
          { Upn: 'bob@example.com', Host: 'web-1' },
        ]),
      ).toEqual({ disabled: 'The 2 selected rows have different Upn values' });
      expect(kqlPivot([{ Upn: '', Host: 'web-1' }])).toMatchObject({
        missing: { 'parameters.Upn': null },
      });
    });
  });
});
