import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnackbarHost } from '../../components/SnackbarHost';
import type { CodeEditorInstance } from '../../components/CodeEditor';
import { apiUrl, problemResponse } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { configureTestApp, resetTestApp } from '../../test/testApp';
import { clearKustoSchemaCache, normalizeSchema } from './kustoSchema';
import { useKustoSchema } from './useKustoSchema';

const setSchema = vi.fn();
vi.mock('../../lib/monaco', () => ({
  getKustoWorkerFor: () => Promise.resolve({ setSchemaFromShowSchema: setSchema }),
}));

const server = setupMswServer();
const editor = {} as CodeEditorInstance;
const wrapper = ({ children }: { children: ReactNode }) => <SnackbarHost>{children}</SnackbarHost>;
const doc = (name: string) => ({
  Databases: { [name]: { Tables: {}, Functions: {}, EntityGroups: {}, Graphs: {} } },
});

let calls: { cluster: string; database: string }[] = [];
const delays: Record<string, number> = {};
beforeEach(() => {
  configureTestApp();
  setSchema.mockReset();
  clearKustoSchemaCache();
  calls = [];
  server.use(
    http.post(apiUrl('/api/kusto/schema'), async ({ request }) => {
      const b = (await request.json()) as { cluster: string; database: string };
      calls.push(b);
      await new Promise((r) => setTimeout(r, delays[b.database] ?? 0));
      return HttpResponse.json({ schema: doc(b.database) });
    }),
  );
});
afterEach(resetTestApp);

describe('useKustoSchema', () => {
  it('loads the schema for the initial cluster and database', async () => {
    renderHook(() => useKustoSchema('contoso', 'Db', editor), { wrapper });
    await waitFor(() => expect(setSchema).toHaveBeenCalledTimes(1));
    expect(setSchema).toHaveBeenCalledWith(doc('Db'), 'https://contoso', 'Db');
    expect(calls).toEqual([{ cluster: 'https://contoso', database: 'Db' }]);
  });

  it('waits for the editor and for a cluster and database', async () => {
    const { rerender } = renderHook(
      ({ c, e }: { c: string; e: CodeEditorInstance | null }) => useKustoSchema(c, 'Db', e),
      { wrapper, initialProps: { c: '', e: null as CodeEditorInstance | null } },
    );
    rerender({ c: 'contoso', e: null });
    rerender({ c: '', e: editor });
    expect(calls).toHaveLength(0);
    rerender({ c: 'contoso', e: editor });
    await waitFor(() => expect(setSchema).toHaveBeenCalledTimes(1));
  });

  it('reloads on change and caches per cluster and database', async () => {
    const { rerender } = renderHook(({ db }) => useKustoSchema('contoso', db, editor), {
      wrapper,
      initialProps: { db: 'A' },
    });
    await waitFor(() => expect(setSchema).toHaveBeenCalledTimes(1));
    rerender({ db: 'B' });
    await waitFor(() => expect(setSchema).toHaveBeenCalledTimes(2));
    rerender({ db: 'A' });
    await waitFor(() => expect(setSchema).toHaveBeenCalledTimes(3));
    expect(calls.map((c) => c.database)).toEqual(['A', 'B']);
    expect(setSchema).toHaveBeenLastCalledWith(doc('A'), 'https://contoso', 'A');
  });

  it('ignores a stale response', async () => {
    delays['Slow'] = 100;
    const { rerender } = renderHook(({ db }) => useKustoSchema('contoso', db, editor), {
      wrapper,
      initialProps: { db: 'Slow' },
    });
    rerender({ db: 'Fast' });
    await waitFor(() => expect(setSchema).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 200));
    expect(setSchema).toHaveBeenCalledTimes(1);
    expect(setSchema).toHaveBeenCalledWith(doc('Fast'), 'https://contoso', 'Fast');
    delete delays['Slow'];
  });

  it('shows the cluster rejection reason, or the generic detail without one', async () => {
    const reason = 'Invalid cluster URL: host is not in the allowed cluster list.';
    server.use(
      http.post(apiUrl('/api/kusto/schema'), () =>
        problemResponse(400, {
          type: 'urn:tim:problem:cluster-not-allowed',
          detail: 'The cluster is not allowed',
          errors: { cluster: [reason] },
        }),
      ),
    );
    const { unmount } = renderHook(() => useKustoSchema('evil', 'Db', editor), { wrapper });
    await waitFor(() =>
      expect(document.body.textContent).toContain(`Failed to load the Kusto schema: ${reason}`),
    );
    expect(document.body.textContent).not.toContain('The cluster is not allowed');
    unmount();

    clearKustoSchemaCache();
    server.use(
      http.post(apiUrl('/api/kusto/schema'), () =>
        problemResponse(400, {
          type: 'urn:tim:problem:cluster-not-allowed',
          detail: 'The cluster is not allowed',
        }),
      ),
    );
    renderHook(() => useKustoSchema('evil2', 'Db', editor), { wrapper });
    await waitFor(() =>
      expect(document.body.textContent).toContain(
        'Failed to load the Kusto schema: The cluster is not allowed',
      ),
    );
  });

  it('notifies on error and does not cache the failure', async () => {
    server.use(
      http.post(apiUrl('/api/kusto/schema'), () => problemResponse(502, { detail: 'Boom' }), {
        once: true,
      }),
    );
    const { rerender } = renderHook(({ db }) => useKustoSchema('contoso', db, editor), {
      wrapper,
      initialProps: { db: 'A' },
    });
    await waitFor(() =>
      expect(document.body.textContent).toContain('Failed to load the Kusto schema: Boom'),
    );
    expect(setSchema).not.toHaveBeenCalled();
    rerender({ db: 'B' });
    rerender({ db: 'A' });
    await waitFor(() => expect(setSchema).toHaveBeenCalledWith(doc('A'), 'https://contoso', 'A'));
  });
});

describe('normalizeSchema', () => {
  it('accepts the schema variants', () => {
    const d = doc('x');
    expect(normalizeSchema(d)).toEqual(d);
    expect(normalizeSchema({ ClusterSchema: JSON.stringify(d) })).toEqual(d);
    expect(normalizeSchema({ DatabaseSchema: d })).toEqual(d);
    expect(normalizeSchema(JSON.stringify(d))).toEqual(d);
    expect(normalizeSchema({ data: [{ ClusterSchema: JSON.stringify(d) }] })).toEqual(d);
    expect(() => normalizeSchema({})).toThrow();
    expect(() => normalizeSchema(undefined)).toThrow();
  });

  it('fills the database members monaco-kusto reads unconditionally (Graphs)', () => {
    const out = normalizeSchema({ Databases: { D: { Name: 'D', Tables: {} } } }) as {
      Databases: Record<string, Record<string, unknown>>;
    };
    expect(out.Databases['D']).toMatchObject({
      Name: 'D',
      Functions: {},
      Graphs: {},
      EntityGroups: {},
    });
  });
});
