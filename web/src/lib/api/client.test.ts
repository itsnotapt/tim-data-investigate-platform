import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { apiUrl, problemResponse, TEST_API, TEST_TRACE_ID } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { createApiClient } from './client';
import { ApiError, CLIENT_PROBLEM } from './errors';
import { getKustoSchema } from './kustoSchema';
import { commentEvents, saveEvents, tagEvents } from './taggedEvents';
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  patchTemplate,
  replaceTemplate,
  restoreTemplate,
  type QueryTemplate,
  type QueryTemplateCreate,
} from './templates';

const server = setupMswServer();

const makeClient = (getToken = () => Promise.resolve('tok-1'), timeoutMs?: number) =>
  createApiClient({ baseUrl: TEST_API, getToken, timeoutMs });

const template: QueryTemplateCreate = {
  uuid: '3f0c2a52-6d0e-4a1b-9a57-0d2d6b8f1c11',
  name: 'T',
  isDeleted: false,
  isManaged: false,
  queryType: 'query',
  menu: 'M',
  summary: 'S',
  path: ['a'],
  cluster: 'https://c.kusto.windows.net',
  database: 'Db',
  query: 'T | take 1',
};

describe('request basics', () => {
  it('sends bearer token, accept and no content-type without a body', async () => {
    let req: Request | undefined;
    server.use(
      http.get(apiUrl('/api/templates/queries'), ({ request }) => {
        req = request;
        return HttpResponse.json([]);
      }),
    );
    await expect(listTemplates({}, { client: makeClient() })).resolves.toEqual([]);
    expect(req?.headers.get('authorization')).toBe('Bearer tok-1');
    expect(req?.headers.get('content-type')).toBeNull();
    expect(req?.headers.get('accept')).toContain('application/json');
  });

  it('acquires the token on every request', async () => {
    server.use(http.get(apiUrl('/api/templates/queries'), () => HttpResponse.json([])));
    const getToken = vi.fn(() => Promise.resolve('t'));
    const client = makeClient(getToken);
    await listTemplates({}, { client });
    await listTemplates({}, { client });
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('passes includeDeleted and since as query params', async () => {
    let url: URL | undefined;
    server.use(
      http.get(apiUrl('/api/templates/queries'), ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json([]);
      }),
    );
    await listTemplates(
      { includeDeleted: true, since: '2026-01-01T00:00:00Z' },
      { client: makeClient() },
    );
    expect(url?.searchParams.get('includeDeleted')).toBe('true');
    expect(url?.searchParams.get('since')).toBe('2026-01-01T00:00:00Z');
  });

  it('omits absent query params', async () => {
    let url: URL | undefined;
    server.use(
      http.get(apiUrl('/api/templates/queries'), ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json([]);
      }),
    );
    await listTemplates({}, { client: makeClient() });
    expect(url?.search).toBe('');
  });
});

describe('error mapping', () => {
  it('maps a problem body to ApiError with traceId and errors', async () => {
    server.use(
      http.post(apiUrl('/api/templates/queries'), () =>
        problemResponse(400, {
          type: 'urn:tim:problem:validation',
          title: 'Validation failed',
          detail: 'name required',
          errors: { name: ['required'] },
        }),
      ),
    );
    const err = await createTemplate(template, { client: makeClient() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 400,
      type: 'urn:tim:problem:validation',
      title: 'Validation failed',
      detail: 'name required',
      message: 'name required',
      traceId: TEST_TRACE_ID,
      errors: { name: ['required'] },
    });
  });

  it('falls back to x-trace-id and status text for non-JSON errors', async () => {
    server.use(
      http.get(
        apiUrl('/api/templates/queries/:uuid'),
        () =>
          new HttpResponse('<html>bad gateway</html>', {
            status: 502,
            statusText: 'Bad Gateway',
            headers: { 'x-trace-id': 'abc' },
          }),
      ),
    );
    const err = await getTemplate('u1', { client: makeClient() }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, title: 'Bad Gateway', traceId: 'abc' });
  });

  it('wraps network failures as status 0', async () => {
    server.use(http.get(apiUrl('/api/templates/queries'), () => HttpResponse.error()));
    const err = await listTemplates({}, { client: makeClient() }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, type: CLIENT_PROBLEM.network });
  });

  it('rejects a 200 with a malformed body', async () => {
    server.use(http.get(apiUrl('/api/templates/queries'), () => new HttpResponse('nope')));
    const err = await listTemplates({}, { client: makeClient() }).catch((e: unknown) => e);
    expect(err).toMatchObject({ type: CLIENT_PROBLEM.invalidResponse });
  });
});

describe('401 handling', () => {
  it('re-acquires the token once and retries', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(apiUrl('/api/templates/queries'), ({ request }) => {
        seen.push(request.headers.get('authorization'));
        return seen.length === 1
          ? problemResponse(401, { type: 'urn:tim:problem:unauthorized' })
          : HttpResponse.json([]);
      }),
    );
    const tokens = ['old', 'new'];
    const getToken = vi.fn(() => Promise.resolve(tokens.shift() ?? 'x'));
    await expect(listTemplates({}, { client: makeClient(getToken) })).resolves.toEqual([]);
    expect(seen).toEqual(['Bearer old', 'Bearer new']);
  });

  it('throws ApiError after a second 401 (no further retries)', async () => {
    let calls = 0;
    server.use(
      http.get(apiUrl('/api/templates/queries'), () => {
        calls++;
        return problemResponse(401, { type: 'urn:tim:problem:unauthorized' });
      }),
    );
    const err = await listTemplates({}, { client: makeClient() }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 401, isUnauthorized: true });
    expect(calls).toBe(2);
  });

  it('propagates token acquisition failure', async () => {
    const getToken = () => Promise.reject(new Error('not signed in'));
    await expect(listTemplates({}, { client: makeClient(getToken) })).rejects.toThrow(
      'not signed in',
    );
  });
});

describe('abort and timeout', () => {
  it('rejects with the abort reason when the signal fires', async () => {
    server.use(
      http.get(apiUrl('/api/templates/queries'), async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json([]);
      }),
    );
    const ac = new AbortController();
    const p = listTemplates({}, { client: makeClient(), signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      listTemplates({}, { client: makeClient(), signal: ac.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('times out with a typed ApiError', async () => {
    server.use(
      http.get(apiUrl('/api/templates/queries'), async () => {
        await new Promise((r) => setTimeout(r, 300));
        return HttpResponse.json([]);
      }),
    );
    const err = await listTemplates({}, { client: makeClient(), timeoutMs: 20 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ isTimeout: true, status: 0 });
  });
});

describe('endpoint modules', () => {
  it('template CRUD uses the right verbs and paths', async () => {
    const seen: string[] = [];
    const bodies: unknown[] = [];
    server.use(
      http.all(apiUrl('/api/templates/queries/:uuid'), async ({ request }) => {
        seen.push(`${request.method} ${new URL(request.url).pathname}`);
        if (request.method === 'DELETE') return new HttpResponse(null, { status: 204 });
        if (request.method !== 'GET') bodies.push(await request.json());
        return HttpResponse.json(template);
      }),
    );
    const client = makeClient();
    await getTemplate('u1', { client });
    await replaceTemplate('u1', template, { client });
    await patchTemplate('u1', [{ op: 'replace', path: '/name', value: 'x' }], { client });
    await restoreTemplate('u1', { client });
    await expect(deleteTemplate('u1', { client })).resolves.toBeUndefined();
    expect(seen).toEqual([
      'GET /api/templates/queries/u1',
      'PUT /api/templates/queries/u1',
      'PATCH /api/templates/queries/u1',
      'PATCH /api/templates/queries/u1',
      'DELETE /api/templates/queries/u1',
    ]);
    expect(bodies[2]).toEqual([{ op: 'replace', path: '/isDeleted', value: false }]);
  });

  it('never sends identity fields in template bodies (SEC-03, BUG-40)', async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post(apiUrl('/api/templates/queries'), async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(template, { status: 201 });
      }),
      http.put(apiUrl('/api/templates/queries/:uuid'), async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(template);
      }),
    );
    const client = makeClient();
    const full = {
      ...template,
      createdBy: 'mallory',
      updatedBy: 'mallory',
      updated: '2026-01-01T00:00:00Z',
      requestedBy: 'mallory',
    } as unknown as QueryTemplate;
    await createTemplate(full, { client });
    await replaceTemplate(template.uuid, full, { client });
    for (const b of bodies) {
      expect(b).not.toHaveProperty('createdBy');
      expect(b).not.toHaveProperty('updatedBy');
      expect(b).not.toHaveProperty('updated');
      expect(b).not.toHaveProperty('requestedBy');
      expect(b['name']).toBe('T');
    }
  });

  it('kusto schema returns the parsed schema document', async () => {
    let body: unknown;
    server.use(
      http.post(apiUrl('/api/kusto/schema'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ schema: { Databases: {} } });
      }),
    );
    await expect(
      getKustoSchema({ cluster: 'https://c', database: 'd' }, { client: makeClient() }),
    ).resolves.toEqual({ Databases: {} });
    expect(body).toEqual({ cluster: 'https://c', database: 'd' });
  });

  it('tagged events post arrays without createdBy/dateTimeUtc and handle 204', async () => {
    const got: Record<string, unknown[]> = {};
    server.use(
      http.post(apiUrl('/api/taggedevents/:kind'), async ({ request, params }) => {
        got[String(params['kind'])] = (await request.json()) as unknown[];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const client = makeClient();
    await saveEvents(
      [
        {
          eventId: 'e1',
          eventTime: '2026-01-01T00:00:00Z',
          eventAsJson: {},
          createdBy: 'mallory',
        } as never,
      ],
      { client },
    );
    await tagEvents([{ eventId: 'e1', tag: 't', isDeleted: false }], { client });
    await commentEvents([{ eventId: 'e1', determination: 'benign', isDeleted: false }], { client });
    await tagEvents([], { client }); // no request for an empty array
    expect(Object.keys(got).sort()).toEqual(['comments', 'savedEvents', 'tags']);
    expect(got['savedEvents']?.[0]).not.toHaveProperty('createdBy');
  });
});
