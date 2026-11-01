import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getKustoWorkerFor: vi.fn(),
  worker: { setSchemaFromShowSchema: vi.fn(), setParameters: vi.fn() },
}));
vi.mock('../../lib/monaco', () => ({ getKustoWorkerFor: h.getKustoWorkerFor }));

import type { CodeEditorInstance } from '../../components/CodeEditor';
import type { LoadedEditorSchema } from './editorSchema';

// The page's one Kusto language service is module state: each test starts with none held.
let adapters: typeof import('./editorSchemaAdapters');
const newEditor = () => ({}) as CodeEditorInstance;
const signal = new AbortController().signal;
const since = { name: 'since', type: 'datetime' as const, value: null };
const limit = { name: 'limit', type: 'long' as const, value: 10 };
const schema = { Plugins: [], Databases: { Logs: { Name: 'Logs', Tables: {}, Functions: {} } } };
const loadedFrom = (connection: string): LoadedEditorSchema => ({
  kind: 'kql',
  schema,
  connection,
  scope: { database: 'Logs' },
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  h.getKustoWorkerFor.mockResolvedValue(h.worker);
  adapters = await import('./editorSchemaAdapters');
});

describe('setEditorParameters', () => {
  it("gives a KQL editor's language service the query parameters, by name and type", async () => {
    await adapters.setEditorParameters(newEditor(), 'kql', [since, limit]);
    expect(h.worker.setParameters).toHaveBeenCalledWith(
      [
        { name: 'since', type: 'datetime' },
        { name: 'limit', type: 'long' },
      ],
      [],
    );
  });

  it('gives a SQL editor nothing', async () => {
    await adapters.setEditorParameters(newEditor(), 'sql', [since]);
    expect(h.getKustoWorkerFor).not.toHaveBeenCalled();
  });

  it('leaves the language service to the editor whose schema it holds', async () => {
    const [a, b] = [newEditor(), newEditor()];
    await adapters.applyEditorSchema(a, loadedFrom('logs'), signal, [since]);
    await adapters.setEditorParameters(b, 'kql', [limit]);
    expect(h.worker.setParameters).not.toHaveBeenCalled();
  });
});

describe('applyEditorSchema', () => {
  it('keeps the query parameters when a KQL schema loads', async () => {
    await adapters.applyEditorSchema(newEditor(), loadedFrom('logs'), signal, [since]);
    expect(h.worker.setSchemaFromShowSchema).toHaveBeenCalledWith(
      expect.anything(),
      'logs',
      'Logs',
      [{ name: 'since', type: 'datetime' }],
    );
  });

  it('keeps query parameters given while a schema loads, which carries the ones before them', async () => {
    // As in monaco-kusto: the schema goes to the worker after a round trip, replacing its parameters.
    let held: unknown[] = [];
    let arrive!: () => void;
    h.worker.setSchemaFromShowSchema.mockImplementationOnce(
      (_schema: unknown, _connection: string, _database: string, parameters: unknown[]) =>
        new Promise<void>((resolve) => {
          arrive = () => {
            held = parameters;
            resolve();
          };
        }),
    );
    h.worker.setParameters.mockImplementationOnce((parameters: unknown[]) => {
      held = parameters;
      return Promise.resolve();
    });
    const editor = newEditor();

    const loading = adapters.applyEditorSchema(editor, loadedFrom('logs'), signal, []);
    await vi.waitFor(() => expect(h.worker.setSchemaFromShowSchema).toHaveBeenCalled());
    const giving = adapters.setEditorParameters(editor, 'kql', [since]);
    // The parameters are given before the schema arrives, if nothing holds them back.
    await new Promise((resolve) => setTimeout(resolve, 0));
    arrive();
    await Promise.all([loading, giving]);

    expect(held).toEqual([{ name: 'since', type: 'datetime' }]);
  });
});

describe('claimEditorSchema', () => {
  it("gives an editor back its schema and query parameters after another editor's", async () => {
    const [a, b] = [newEditor(), newEditor()];
    await adapters.applyEditorSchema(a, loadedFrom('logs'), signal, [since]);
    await adapters.applyEditorSchema(b, loadedFrom('audit'), signal, [limit]);
    h.worker.setSchemaFromShowSchema.mockClear();

    await adapters.claimEditorSchema(a, 'kql', loadedFrom('logs'), [since]);
    expect(h.worker.setSchemaFromShowSchema).toHaveBeenCalledWith(
      expect.anything(),
      'logs',
      'Logs',
      [{ name: 'since', type: 'datetime' }],
    );
    // Its own again, so a later pill change reaches it.
    await adapters.setEditorParameters(a, 'kql', []);
    expect(h.worker.setParameters).toHaveBeenCalledWith([], []);
  });

  it('gives nothing to the editor that holds it already', async () => {
    const a = newEditor();
    await adapters.applyEditorSchema(a, loadedFrom('logs'), signal, [since]);
    h.worker.setSchemaFromShowSchema.mockClear();
    await adapters.claimEditorSchema(a, 'kql', loadedFrom('logs'), [since]);
    expect(h.getKustoWorkerFor).toHaveBeenCalledTimes(1);
  });

  it('gives an editor without a schema yet its query parameters', async () => {
    const [a, b] = [newEditor(), newEditor()];
    await adapters.applyEditorSchema(a, loadedFrom('logs'), signal, [since]);
    await adapters.claimEditorSchema(b, 'kql', null, [limit]);
    expect(h.worker.setParameters).toHaveBeenCalledWith([{ name: 'limit', type: 'long' }], []);
  });

  it('gives a SQL editor nothing', async () => {
    await adapters.claimEditorSchema(newEditor(), 'sql', null, [since]);
    expect(h.getKustoWorkerFor).not.toHaveBeenCalled();
  });
});
