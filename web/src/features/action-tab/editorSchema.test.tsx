import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeEditorInstance } from '../../components/CodeEditor';
import { SnackbarHost } from '../../components/SnackbarHost';
import type { CatalogueParam } from '../../lib/api';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { clearEditorSchemaCache, loadEditorSchema, useEditorSchema } from './editorSchema';

const setSchema = vi.fn();
vi.mock('../../lib/monaco', () => ({
  getKustoWorkerFor: () => Promise.resolve({ setSchemaFromShowSchema: setSchema }),
}));

const server = setupMswServer();
const editor = {} as CodeEditorInstance;
const doc = (name: string) => ({
  Databases: { [name]: { Tables: {}, Functions: {}, EntityGroups: {}, Graphs: {} } },
});

const wrapper = ({ children }: { children: ReactNode }) => <SnackbarHost>{children}</SnackbarHost>;
const runKql: CatalogueParam[] = [
  { name: 'connection', title: 'Connection', kind: 'connection', required: true, many: false },
  { name: 'database', title: 'Database', kind: 'string', required: true, many: false },
  {
    name: 'kql',
    title: 'Query',
    kind: 'kql',
    required: true,
    many: false,
    schemaFrom: ['connection', 'database'],
  },
];
const kql = runKql[2]!;

let calls: { name: string; scope: Record<string, unknown> }[] = [];
const delays: Record<string, number> = {};
beforeEach(() => {
  configureTestApp();
  setSchema.mockReset();
  clearEditorSchemaCache();
  calls = [];
  server.use(
    http.post(apiUrl('/api/connections/:name/schema'), async ({ params, request }) => {
      const { scope } = (await request.json()) as { scope: Record<string, unknown> };
      calls.push({ name: String(params.name), scope });
      await new Promise((r) => setTimeout(r, delays[String(scope.database)] ?? 0));
      return HttpResponse.json({ kind: 'kql', schema: doc(String(scope.database)) });
    }),
  );
});
afterEach(resetTestApp);

describe('loadEditorSchema', () => {
  it('gives a kql schema to the Kusto worker, with the connection name as the cluster', async () => {
    await loadEditorSchema(editor, 'security', { database: 'Samples' });
    expect(calls).toEqual([{ name: 'security', scope: { database: 'Samples' } }]);
    expect(setSchema).toHaveBeenCalledWith(doc('Samples'), 'security', 'Samples');
  });

  it('fetches each connection and scope once, then reads the cache', async () => {
    await loadEditorSchema(editor, 'security', { database: 'A' });
    await loadEditorSchema(editor, 'security', { database: 'B' });
    await Promise.all([
      loadEditorSchema(editor, 'security', { database: 'A' }),
      loadEditorSchema(editor, 'other', { database: 'A' }),
      loadEditorSchema(editor, 'other', { database: 'A' }),
    ]);
    expect(calls).toEqual([
      { name: 'security', scope: { database: 'A' } },
      { name: 'security', scope: { database: 'B' } },
      { name: 'other', scope: { database: 'A' } },
    ]);
    expect(setSchema).toHaveBeenCalledTimes(5);
    expect(setSchema).toHaveBeenNthCalledWith(3, doc('A'), 'security', 'A');
  });

  it('fetches again after a failure', async () => {
    server.use(
      http.post(
        apiUrl('/api/connections/:name/schema'),
        () => problemResponse(502, { detail: "'Nope' was not found" }),
        { once: true },
      ),
    );
    await expect(loadEditorSchema(editor, 'security', { database: 'Nope' })).rejects.toThrow(
      "'Nope' was not found",
    );
    await loadEditorSchema(editor, 'security', { database: 'Nope' });
    expect(calls).toHaveLength(1);
    expect(setSchema).toHaveBeenCalledTimes(1);
  });

  it('leaves the editor alone when the connection has no schema for the scope', async () => {
    server.use(
      http.post(apiUrl('/api/connections/:name/schema'), () =>
        HttpResponse.json({ kind: null, schema: null }),
      ),
    );
    await loadEditorSchema(editor, 'security', {});
    expect(setSchema).not.toHaveBeenCalled();
  });
});

describe('useEditorSchema', () => {
  const render = (values: Record<string, unknown>, e: CodeEditorInstance | null = editor) =>
    renderHook((p) => useEditorSchema(p.e, kql, runKql, p.values), {
      wrapper,
      initialProps: { e, values },
    });

  it('loads the schema of the chosen connection and database once the editor exists', async () => {
    const { rerender } = render({ connection: 'security' }, null);
    rerender({ e: editor, values: { connection: 'security' } });
    rerender({ e: null, values: { connection: 'security', database: 'Samples' } });
    expect(calls).toEqual([]);
    rerender({ e: editor, values: { connection: 'security', database: 'Samples' } });
    await waitFor(() => expect(setSchema).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ name: 'security', scope: { database: 'Samples' } }]);
    expect(setSchema).toHaveBeenCalledWith(doc('Samples'), 'security', 'Samples');
  });

  it('ignores a schema that arrives after the database changed', async () => {
    delays['Slow'] = 100;
    const { rerender } = render({ connection: 'security', database: 'Slow' });
    rerender({ e: editor, values: { connection: 'security', database: 'Fast' } });
    await waitFor(() => expect(setSchema).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 200));
    expect(setSchema).toHaveBeenCalledTimes(1);
    expect(setSchema).toHaveBeenCalledWith(doc('Fast'), 'security', 'Fast');
    delete delays['Slow'];
  });

  it('shows a failure in the snackbar', async () => {
    server.use(
      http.post(apiUrl('/api/connections/:name/schema'), () =>
        problemResponse(502, { detail: "'Nope' was not found" }),
      ),
    );
    render({ connection: 'security', database: 'Nope' });
    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "Failed to load the editor schema: 'Nope' was not found",
      ),
    );
  });
});
