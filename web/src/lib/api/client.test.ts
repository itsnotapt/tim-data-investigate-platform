import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { apiUrl, problemResponse, TEST_API, TEST_TRACE_ID } from '../../test/msw/handlers';
import { setupMswServer } from '../../test/msw/server';
import { createApiClient } from './client';
import { ApiError, CLIENT_PROBLEM } from './errors';
import {
  createPreset,
  deletePreset,
  listPresets,
  replacePreset,
  setPresetHidden,
  type PresetFields,
} from './presets';

const server = setupMswServer();

const makeClient = (getToken = () => Promise.resolve('tok-1'), timeoutMs?: number) =>
  createApiClient({ baseUrl: TEST_API, getToken, timeoutMs });

const preset: PresetFields = { action: 'kusto', name: 'P', visibility: 'private' };

describe('request basics', () => {
  it('sends bearer token, accept and no content-type without a body', async () => {
    let req: Request | undefined;
    server.use(
      http.get(apiUrl('/api/presets'), ({ request }) => {
        req = request;
        return HttpResponse.json([]);
      }),
    );
    await expect(listPresets({ client: makeClient() })).resolves.toEqual([]);
    expect(req?.headers.get('authorization')).toBe('Bearer tok-1');
    expect(req?.headers.get('content-type')).toBeNull();
    expect(req?.headers.get('accept')).toContain('application/json');
  });

  it('acquires the token on every request', async () => {
    server.use(http.get(apiUrl('/api/presets'), () => HttpResponse.json([])));
    const getToken = vi.fn(() => Promise.resolve('t'));
    const client = makeClient(getToken);
    await listPresets({ client });
    await listPresets({ client });
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('passes query params, omitting absent ones', async () => {
    const urls: URL[] = [];
    server.use(
      http.get(apiUrl('/api/things'), ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json([]);
      }),
    );
    const client = makeClient();
    await client.request({
      path: '/api/things',
      query: { a: 'x', b: true, c: undefined, d: null },
    });
    await client.request({ path: '/api/things', query: { c: undefined } });
    expect([...(urls[0]?.searchParams ?? [])]).toEqual([
      ['a', 'x'],
      ['b', 'true'],
    ]);
    expect(urls[1]?.search).toBe('');
  });
});

describe('error mapping', () => {
  it('maps a problem body to ApiError with traceId and errors', async () => {
    server.use(
      http.post(apiUrl('/api/presets'), () =>
        problemResponse(422, {
          type: 'urn:tim:problem:validation',
          title: 'Validation failed',
          detail: 'name required',
          errors: { name: ['required'] },
        }),
      ),
    );
    const err = await createPreset(preset, { client: makeClient() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 422,
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
      http.put(
        apiUrl('/api/presets/:id'),
        () =>
          new HttpResponse('<html>bad gateway</html>', {
            status: 502,
            statusText: 'Bad Gateway',
            headers: { 'x-trace-id': 'abc' },
          }),
      ),
    );
    const err = await replacePreset('u1', preset, { client: makeClient() }).catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ status: 502, title: 'Bad Gateway', traceId: 'abc' });
  });

  it('wraps network failures as status 0', async () => {
    server.use(http.get(apiUrl('/api/presets'), () => HttpResponse.error()));
    const err = await listPresets({ client: makeClient() }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, type: CLIENT_PROBLEM.network });
  });

  it('rejects a 200 with a malformed body', async () => {
    server.use(http.get(apiUrl('/api/presets'), () => new HttpResponse('nope')));
    const err = await listPresets({ client: makeClient() }).catch((e: unknown) => e);
    expect(err).toMatchObject({ type: CLIENT_PROBLEM.invalidResponse });
  });
});

describe('401 handling', () => {
  it('re-acquires the token once and retries', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(apiUrl('/api/presets'), ({ request }) => {
        seen.push(request.headers.get('authorization'));
        return seen.length === 1
          ? problemResponse(401, { type: 'urn:tim:problem:unauthorized' })
          : HttpResponse.json([]);
      }),
    );
    const tokens = ['old', 'new'];
    const getToken = vi.fn(() => Promise.resolve(tokens.shift() ?? 'x'));
    await expect(listPresets({ client: makeClient(getToken) })).resolves.toEqual([]);
    expect(seen).toEqual(['Bearer old', 'Bearer new']);
  });

  it('throws ApiError after a second 401 (no further retries)', async () => {
    let calls = 0;
    server.use(
      http.get(apiUrl('/api/presets'), () => {
        calls++;
        return problemResponse(401, { type: 'urn:tim:problem:unauthorized' });
      }),
    );
    const err = await listPresets({ client: makeClient() }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 401, isUnauthorized: true });
    expect(calls).toBe(2);
  });

  it('propagates token acquisition failure', async () => {
    const getToken = () => Promise.reject(new Error('not signed in'));
    await expect(listPresets({ client: makeClient(getToken) })).rejects.toThrow('not signed in');
  });
});

describe('abort and timeout', () => {
  it('rejects with the abort reason when the signal fires', async () => {
    server.use(
      http.get(apiUrl('/api/presets'), async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json([]);
      }),
    );
    const ac = new AbortController();
    const p = listPresets({ client: makeClient(), signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(listPresets({ client: makeClient(), signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('times out with a typed ApiError', async () => {
    server.use(
      http.get(apiUrl('/api/presets'), async () => {
        await new Promise((r) => setTimeout(r, 300));
        return HttpResponse.json([]);
      }),
    );
    const err = await listPresets({ client: makeClient(), timeoutMs: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ isTimeout: true, status: 0 });
  });
});

describe('endpoint modules', () => {
  it('preset writes use the right verbs and paths', async () => {
    const seen: string[] = [];
    const bodies: unknown[] = [];
    const record = async (request: Request) => {
      seen.push(`${request.method} ${new URL(request.url).pathname}`);
      if (request.method === 'POST' || request.method === 'PUT') {
        const body: unknown = await request
          .clone()
          .json()
          .catch(() => undefined);
        if (body !== undefined) bodies.push(body);
      }
    };
    server.use(
      http.post(apiUrl('/api/presets'), async ({ request }) => {
        await record(request);
        return HttpResponse.json({ ...preset, presetId: 'p1' }, { status: 201 });
      }),
      http.all(apiUrl('/api/presets/:id/hidden'), async ({ request }) => {
        await record(request);
        return new HttpResponse(null, { status: 204 });
      }),
      http.all(apiUrl('/api/presets/:id'), async ({ request }) => {
        await record(request);
        if (request.method === 'DELETE') return new HttpResponse(null, { status: 204 });
        return HttpResponse.json({ ...preset, presetId: 'p1' });
      }),
    );
    const client = makeClient();
    await createPreset(preset, { client });
    await replacePreset('a/b', preset, { client });
    await setPresetHidden('p1', true, { client });
    await setPresetHidden('p1', false, { client });
    await expect(deletePreset('p1', { client })).resolves.toBeUndefined();
    expect(seen).toEqual([
      'POST /api/presets',
      'PUT /api/presets/a%2Fb',
      'PUT /api/presets/p1/hidden',
      'DELETE /api/presets/p1/hidden',
      'DELETE /api/presets/p1',
    ]);
    expect(bodies).toEqual([preset, preset]);
  });
});
