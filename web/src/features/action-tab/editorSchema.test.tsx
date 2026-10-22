import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnackbarHost } from '../../components/SnackbarHost';
import type { CatalogueParam } from '../../lib/api';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { clearEditorSchemaCache, useEditorSchema, type SchemaHandler } from './editorSchema';

const server = setupMswServer();
const doc = (name: string) => ({
  Databases: { [name]: { Tables: {}, Functions: {}, EntityGroups: {}, Graphs: {} } },
});
const expectedSchema = (connection: string, database: string) => ({
  kind: 'kql',
  schema: doc(database),
  connection,
  scope: { database },
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
const onSchema = vi.fn<SchemaHandler>();
beforeEach(() => {
  configureTestApp();
  onSchema.mockReset();
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

describe('useEditorSchema', () => {
  const render = (values: Record<string, unknown>, handler: SchemaHandler | null = onSchema) =>
    renderHook((p) => useEditorSchema(kql, runKql, p.values, p.handler), {
      wrapper,
      initialProps: { handler, values },
    });

  // Longer than the hook's settle delay, for checks that nothing was fetched.
  const pastSettling = () => new Promise((r) => setTimeout(r, 500));

  it('fetches nothing until every schemaFrom param has a value', async () => {
    const { rerender } = render({ connection: 'security' });
    await pastSettling();
    expect(calls).toEqual([]);
    rerender({ handler: onSchema, values: { connection: 'security', database: 'Samples' } });
    await waitFor(() => expect(onSchema).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ name: 'security', scope: { database: 'Samples' } }]);
    expect(onSchema).toHaveBeenCalledWith(
      expectedSchema('security', 'Samples'),
      expect.any(AbortSignal),
    );
  });

  it('fetches nothing until there is a handler', async () => {
    const { rerender } = render({ connection: 'security', database: 'Samples' }, null);
    await pastSettling();
    expect(calls).toEqual([]);
    rerender({ handler: onSchema, values: { connection: 'security', database: 'Samples' } });
    await waitFor(() => expect(onSchema).toHaveBeenCalledTimes(1));
  });

  it('fetches each connection and scope once, then reads the cache', async () => {
    const { rerender } = render({ connection: 'security', database: 'A' });
    await waitFor(() => expect(onSchema).toHaveBeenCalledTimes(1));
    rerender({ handler: onSchema, values: { connection: 'security', database: 'B' } });
    await waitFor(() => expect(onSchema).toHaveBeenCalledTimes(2));
    rerender({ handler: onSchema, values: { connection: 'security', database: 'A' } });
    render({ connection: 'other', database: 'A' });
    render({ connection: 'other', database: 'A' });
    await waitFor(() => expect(onSchema).toHaveBeenCalledTimes(5));
    expect(calls).toEqual([
      { name: 'security', scope: { database: 'A' } },
      { name: 'security', scope: { database: 'B' } },
      { name: 'other', scope: { database: 'A' } },
    ]);
    expect(onSchema).toHaveBeenNthCalledWith(
      3,
      expectedSchema('security', 'A'),
      expect.any(AbortSignal),
    );
  });

  it('fetches again after a failure', async () => {
    server.use(
      http.post(
        apiUrl('/api/connections/:name/schema'),
        () => problemResponse(502, { detail: "'Nope' was not found" }),
        { once: true },
      ),
    );
    const first = render({ connection: 'security', database: 'Nope' });
    await waitFor(() => expect(document.body.textContent).toContain("'Nope' was not found"));
    first.unmount();
    render({ connection: 'security', database: 'Nope' });
    await waitFor(() => expect(onSchema).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ name: 'security', scope: { database: 'Nope' } }]);
  });

  it('waits for a typed database to settle before fetching', async () => {
    const { rerender } = render({ connection: 'security', database: 'S' });
    rerender({ handler: onSchema, values: { connection: 'security', database: 'Sa' } });
    rerender({ handler: onSchema, values: { connection: 'security', database: 'Samples' } });
    await waitFor(() => expect(onSchema).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ name: 'security', scope: { database: 'Samples' } }]);
  });

  it('ignores a schema that arrives after the database changed', async () => {
    delays['Slow'] = 300;
    const { rerender } = render({ connection: 'security', database: 'Slow' });
    await waitFor(() => expect(calls).toHaveLength(1));
    rerender({ handler: onSchema, values: { connection: 'security', database: 'Fast' } });
    await waitFor(() => expect(onSchema).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 400));
    expect(onSchema).toHaveBeenCalledTimes(1);
    expect(onSchema).toHaveBeenCalledWith(
      expectedSchema('security', 'Fast'),
      expect.any(AbortSignal),
    );
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

  it('hands nothing over when the connection has no schema for the scope', async () => {
    let answered = false;
    server.use(
      http.post(apiUrl('/api/connections/:name/schema'), () => {
        answered = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render({ connection: 'security', database: 'Samples' });
    await waitFor(() => expect(answered).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(onSchema).not.toHaveBeenCalled();
  });
});
