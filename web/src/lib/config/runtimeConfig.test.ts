import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRuntimeConfig } from './runtimeConfig';

const fullWindow = {
  auth: { clientId: 'cid', authority: 'https://login.example.com/tenant' },
  redirectUri: 'https://app.example.com/blank.html',
  apiEndpoint: '/api/',
  wikiUri: 'https://wiki.example.com',
  issueUri: 'https://issues.example.com',
  tagCluster: 'https://tags.kusto.windows.net',
  tagDatabase: 'Tags',
};

const fullEnv = {
  VITE_AUTH_CLIENT_ID: 'env-cid',
  VITE_AUTH_AUTHORITY: 'https://login.env.com/tenant',
  VITE_AUTH_REDIRECT: 'https://env.example.com/blank.html',
  VITE_API_ENDPOINT: '/env-api',
  VITE_TAG_CLUSTER: 'https://env.kusto.windows.net',
};

describe('loadRuntimeConfig', () => {
  it('lets window.appConfig override env values', () => {
    const c = loadRuntimeConfig(fullWindow, fullEnv);
    expect(c.auth.clientId).toBe('cid');
    expect(c.redirectUri).toBe('https://app.example.com/blank.html');
    expect(c.tagCluster).toBe('https://tags.kusto.windows.net');
    expect(c.apiEndpoint).toBe('/api');
  });

  it('falls back to env when appConfig is absent', () => {
    const c = loadRuntimeConfig(undefined, fullEnv);
    expect(c.auth).toEqual({ clientId: 'env-cid', authority: 'https://login.env.com/tenant' });
    expect(c.apiEndpoint).toBe('/env-api');
    expect(c.tagDatabase).toBe('Research');
  });

  it('merges per key, including nested auth fields', () => {
    const c = loadRuntimeConfig({ auth: { clientId: 'only-id' } }, fullEnv);
    expect(c.auth).toEqual({ clientId: 'only-id', authority: 'https://login.env.com/tenant' });
  });

  it('names every missing required key in the error', () => {
    expect(() => loadRuntimeConfig({}, {})).toThrow(/auth\.clientId/);
    try {
      loadRuntimeConfig({}, {});
    } catch (e) {
      const m = (e as Error).message;
      for (const k of ['auth.clientId', 'auth.authority', 'redirectUri', 'tagCluster']) {
        expect(m).toContain(k);
      }
    }
  });

  it('reports invalid values', () => {
    expect(() => loadRuntimeConfig({ ...fullWindow, redirectUri: 'nope' }, {})).toThrow(
      /redirectUri: must be an http\(s\) URL/,
    );
  });

  it('treats empty strings and $VAR placeholders as missing', () => {
    const w = { ...fullWindow, auth: { clientId: '$AUTH_CLIENT_ID', authority: '' } };
    expect(() => loadRuntimeConfig(w, {})).toThrow(/auth\.clientId[\s\S]*auth\.authority/);
    // Placeholder falls through to the env fallback.
    const c = loadRuntimeConfig({ ...fullWindow, tagCluster: '${TAG_CLUSTER}' }, fullEnv);
    expect(c.tagCluster).toBe('https://env.kusto.windows.net');
  });

  it('treats agGridLicenseKey as optional', () => {
    expect(loadRuntimeConfig(fullWindow, {}).agGridLicenseKey).toBeUndefined();
    expect(
      loadRuntimeConfig({ ...fullWindow, agGridLicenseKey: '$AGGRID_LICENSE' }, {}),
    ).not.toHaveProperty('agGridLicenseKey', 'x');
    expect(loadRuntimeConfig({ ...fullWindow, agGridLicenseKey: 'key' }, {}).agGridLicenseKey).toBe(
      'key',
    );
  });

  it('parses defaultClusters from window config and env JSON, with a default', () => {
    const groups = [{ name: 'A', clusters: ['https://a.kusto.windows.net'], databases: ['db'] }];
    expect(
      loadRuntimeConfig({ ...fullWindow, defaultClusters: groups }, {}).defaultClusters,
    ).toEqual(groups);
    const env = { VITE_DEFAULT_CLUSTERS: JSON.stringify(groups) };
    expect(loadRuntimeConfig(fullWindow, env).defaultClusters).toEqual(groups);
    expect(loadRuntimeConfig(fullWindow, {}).defaultClusters[0]?.name).toBe('Example');
    expect(() => loadRuntimeConfig(fullWindow, { VITE_DEFAULT_CLUSTERS: '{' })).toThrow(
      /not valid JSON/,
    );
  });

  it('drops cluster groups made of unsubstituted placeholders', () => {
    const w = {
      ...fullWindow,
      defaultClusters: [
        { name: 'Cluster', clusters: ['$KUSTO_CLUSTER_URI'], databases: ['$KUSTO_DATABASE_NAME'] },
      ],
    };
    expect(loadRuntimeConfig(w, {}).defaultClusters[0]?.name).toBe('Example');
  });

  it('normalises apiEndpoint: empty allowed, trailing slash stripped', () => {
    expect(loadRuntimeConfig({ ...fullWindow, apiEndpoint: '' }, {}).apiEndpoint).toBe('');
    expect(
      loadRuntimeConfig({ ...fullWindow, apiEndpoint: 'https://x.com/api//' }, {}).apiEndpoint,
    ).toBe('https://x.com/api');
  });

  it('VITE_TAG_* env vars work and nodeEnv is not part of the config', () => {
    const { tagCluster: _t, tagDatabase: _d, ...rest } = fullWindow;
    void _t;
    void _d;
    const c = loadRuntimeConfig(rest, {
      VITE_TAG_CLUSTER: 'https://dev.kusto.windows.net',
      VITE_TAG_DATABASE: 'DevTags',
    });
    expect(c.tagCluster).toBe('https://dev.kusto.windows.net');
    expect(c.tagDatabase).toBe('DevTags');
    expect(c).not.toHaveProperty('nodeEnv');
    expect(loadRuntimeConfig({ ...fullWindow, nodeEnv: 'production' }, {})).not.toHaveProperty(
      'nodeEnv',
    );
  });

  it('default wiki and issue URIs are valid https and the license env var is read', () => {
    const { issueUri: _i, ...rest } = fullWindow;
    void _i;
    const c = loadRuntimeConfig(rest, { VITE_AGGRID_LICENSE_KEY: 'lic' });
    expect(c.issueUri).toMatch(/^https:\/\//);
    expect(c.wikiUri).toMatch(/^https:\/\//);
    expect(c.agGridLicenseKey).toBe('lic');
    expect(() => loadRuntimeConfig({ ...fullWindow, issueUri: 'ttps://x.com' }, {})).toThrow(
      /issueUri/,
    );
  });
});

describe('.env.example', () => {
  const example = readFileSync(resolve(import.meta.dirname, '../../../.env.example'), 'utf8');
  const documented = [...example.matchAll(/^#?\s*(VITE_[A-Z0-9_]+)=/gm)].map((m) => m[1]);
  const source = ['runtimeConfig.ts', '../auth/index.ts']
    .map((f) => readFileSync(resolve(import.meta.dirname, f), 'utf8'))
    .join('\n');

  it('lists variables', () => {
    expect(documented.length).toBeGreaterThan(0);
  });

  it.each(documented)('documents %s, which the app reads', (name) => {
    expect(source).toContain(name);
  });

  it('names the AG Grid licence key VITE_AGGRID_LICENSE_KEY', () => {
    expect(documented).toContain('VITE_AGGRID_LICENSE_KEY');
    expect(
      loadRuntimeConfig({}, { ...fullEnv, VITE_AGGRID_LICENSE_KEY: 'key-1' }).agGridLicenseKey,
    ).toBe('key-1');
  });
});
