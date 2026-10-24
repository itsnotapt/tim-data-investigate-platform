import { describe, expect, it } from 'vitest';
import type { CatalogueAction, InstanceConnection, Preset } from '../../lib/api';
import { presetTabParams } from './openPreset';

const runKql: CatalogueAction = {
  key: 'tim.run_kql',
  kind: 'query',
  actionFile: true,
  name: 'Run KQL',
  menuPath: [],
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
    { name: 'database', title: 'Database', kind: 'string', required: true, many: false },
    { name: 'kql', title: 'Query', kind: 'kql', required: true, many: false },
    { name: 'parameters', title: 'Query parameters', kind: 'json', required: false, many: false },
  ],
  pivot: null,
};

const connections: InstanceConnection[] = [
  { name: 'security', type: 'kusto', title: 'Security', editor: 'kql' },
];

const preset = (inputs: Preset['inputs']): Preset => ({
  presetId: 'p-1',
  name: 'Sign-ins by user',
  menuPath: [],
  owner: 'alice@example.com',
  visibility: 'private',
  owned: true,
  hidden: false,
  action: 'tim.run_kql',
  params: { database: 'Samples', kql: 'SigninLogs | where UserPrincipalName == Upn' },
  inputs,
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
});

describe('presetTabParams', () => {
  it('fills parameters from the query parameters, with From row ones missing', () => {
    const opened = presetTabParams(
      preset([
        {
          name: 'Upn',
          source: 'queryParameter',
          type: 'string',
          fixed: false,
          fromColumns: ['UserPrincipalName'],
        },
        {
          name: 'Since',
          source: 'queryParameter',
          type: 'datetime',
          fixed: true,
          value: '2026-10-01T00:00:00Z',
        },
      ]),
      runKql,
      connections,
    );

    expect(opened).toEqual({
      params: {
        connection: 'security',
        database: 'Samples',
        kql: 'SigninLogs | where UserPrincipalName == Upn',
        parameters: [
          { name: 'Upn', type: 'string', value: null },
          { name: 'Since', type: 'datetime', value: '2026-10-01T00:00:00Z' },
        ],
      },
      missing: { 'parameters.Upn': null },
    });
  });

  it('leaves parameters out of a preset without query parameters', () => {
    expect(presetTabParams(preset([]), runKql, connections).params).not.toHaveProperty(
      'parameters',
    );
  });
});
