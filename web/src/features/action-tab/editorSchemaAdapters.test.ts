import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getKustoWorkerFor: vi.fn(),
  worker: { setSchemaFromShowSchema: vi.fn(), setParameters: vi.fn() },
}));
vi.mock('../../lib/monaco', () => ({ getKustoWorkerFor: h.getKustoWorkerFor }));

import type { CodeEditorInstance } from '../../components/CodeEditor';
import { applyEditorSchema, setEditorParameters } from './editorSchemaAdapters';

const editor = {} as CodeEditorInstance;
const since = { name: 'since', type: 'datetime' as const, value: null };
const limit = { name: 'limit', type: 'long' as const, value: 10 };
const schema = { Plugins: [], Databases: { Logs: { Name: 'Logs', Tables: {}, Functions: {} } } };

beforeEach(() => {
  vi.clearAllMocks();
  h.getKustoWorkerFor.mockResolvedValue(h.worker);
});

describe('setEditorParameters', () => {
  it("gives a KQL editor's language service the query parameters, by name and type", async () => {
    await setEditorParameters(editor, 'kql', [since, limit]);
    expect(h.worker.setParameters).toHaveBeenCalledWith(
      [
        { name: 'since', type: 'datetime' },
        { name: 'limit', type: 'long' },
      ],
      [],
    );
  });

  it('gives a SQL editor nothing', async () => {
    await setEditorParameters(editor, 'sql', [since]);
    expect(h.getKustoWorkerFor).not.toHaveBeenCalled();
  });
});

describe('applyEditorSchema', () => {
  it('keeps the query parameters when a KQL schema loads', async () => {
    const loaded = { kind: 'kql', schema, connection: 'logs', scope: { database: 'Logs' } };
    await applyEditorSchema(editor, loaded, new AbortController().signal, [since]);
    expect(h.worker.setSchemaFromShowSchema).toHaveBeenCalledWith(
      expect.anything(),
      'logs',
      'Logs',
      [{ name: 'since', type: 'datetime' }],
    );
  });
});
