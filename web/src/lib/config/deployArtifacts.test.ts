// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Security regression tests for the container entrypoint and the nginx template.
const docker = resolve(import.meta.dirname, '../../../docker');
const hasTools = spawnSync('sh', ['-c', 'command -v jq']).status === 0;

const baseEnv = {
  BACKEND_URI: 'http://api:8080',
  REDIRECT_URI: 'https://tim.example.com/blank.html',
  AUTH_CLIENT_ID: 'client',
  AUTH_TENANT_ID: 'tenant.example.com',
  TAG_CLUSTER: 'https://tags.kusto.windows.net',
  AGGRID_LICENSE: 'license',
};

function runEntrypoint(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'tim-entry-'));
  const r = spawnSync('sh', [join(docker, 'docker-entrypoint.sh')], {
    env: {
      PATH: process.env['PATH'] ?? '',
      TIM_ENTRYPOINT_DRY_RUN: '1',
      TIM_RUNTIME_DIR: dir,
      TIM_NGINX_TEMPLATE: join(docker, 'nginx.conf.template'),
      NGINX_RESOLVER: '127.0.0.11',
      ...baseEnv,
      ...env,
    },
    encoding: 'utf8',
  });
  const read = (f: string) => (r.status === 0 ? readFileSync(join(dir, f), 'utf8') : '');
  return {
    status: r.status,
    stderr: r.stderr,
    config: read('config.js'),
    conf: read('nginx.conf'),
  };
}

describe.skipIf(!hasTools)('web container entrypoint', () => {
  it('hostile env values cannot break out of config.js', () => {
    const evil = `a"b</script><script>alert(1)//\\ ${String.fromCharCode(0x2028)} </ScRiPt>`;
    const { status, config } = runEntrypoint({
      AUTH_CLIENT_ID: evil,
      AGGRID_LICENSE: evil,
      HELP_WIKI_URI: `https://w.example/"${evil}`,
      DEFAULT_CLUSTERS: JSON.stringify([{ name: evil, clusters: ['https://c'], databases: [] }]),
    });
    expect(status).toBe(0);
    expect(config.toLowerCase()).not.toContain('</script');
    const sandbox: { appConfig?: { auth: { clientId: string }; agGridLicenseKey: string } } = {};
    runInNewContext(config, { window: sandbox });
    expect(sandbox.appConfig?.auth.clientId).toBe(evil);
    expect(sandbox.appConfig?.agGridLicenseKey).toBe(evil);
  });

  it('AGGRID_LICENSE is optional; without it config.js has an empty agGridLicenseKey', () => {
    for (const env of <Record<string, string>[]>[
      { AGGRID_LICENSE: '' },
      { AGGRID_LICENSE: '', TIM_ENVIRONMENT: 'production' },
    ]) {
      const { status, stderr, config } = runEntrypoint(env);
      expect(status).toBe(0);
      expect(stderr).not.toContain('missing required');
      expect(stderr).toContain('trial mode');
      const sandbox: { appConfig?: { agGridLicenseKey?: string } } = {};
      runInNewContext(config, { window: sandbox });
      expect(sandbox.appConfig?.agGridLicenseKey).toBe('');
    }
  });

  it('renders a CSP without script unsafe-inline and with same-origin connect-src', () => {
    const { status, conf } = runEntrypoint({});
    expect(status).toBe(0);
    const csp = /add_header Content-Security-Policy "([^"]+)"/.exec(conf)?.[1] ?? '';
    const directive = (name: string) =>
      csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith(`${name} `)) ?? '';
    expect(directive('script-src')).not.toContain("'unsafe-inline'");
    expect(directive('script-src')).not.toContain('*');
    expect(directive('connect-src')).toBe("connect-src 'self' https://login.microsoftonline.com");
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'self'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('worker-src')).toContain("'self'");
    expect(conf).not.toContain('@CSP_CONNECT_EXTRA@');
  });

  it('a cross-origin API_BASEPATH is allowed in connect-src, junk is refused', () => {
    const ok = runEntrypoint({ API_BASEPATH: 'https://api.example.com:8443/base' });
    expect(ok.conf).toContain('https://login.microsoftonline.com https://api.example.com:8443;');
    const bad = runEntrypoint({ API_BASEPATH: 'https://a.example; script-src *' });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('API_BASEPATH');
  });
});

describe('read-only root filesystem', () => {
  const tpl = readFileSync(join(docker, 'nginx.conf.template'), 'utf8');
  const dockerfile = readFileSync(join(docker, '../Dockerfile'), 'utf8');

  it.skipIf(!hasTools)('writes config.js and the nginx conf only under TIM_RUNTIME_DIR', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tim-entry-'));
    const runtime = join(dir, 'run');
    const r = spawnSync('sh', [join(docker, 'docker-entrypoint.sh')], {
      env: {
        PATH: process.env['PATH'] ?? '',
        TIM_ENTRYPOINT_DRY_RUN: '1',
        TIM_RUNTIME_DIR: runtime,
        TIM_NGINX_TEMPLATE: join(docker, 'nginx.conf.template'),
        NGINX_RESOLVER: '127.0.0.11',
        ...baseEnv,
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(readdirSync(dir)).toEqual(['run']);
    expect(readdirSync(runtime).sort()).toEqual(['config.js', 'nginx.conf']);
  });

  it('serves /config.js from the runtime dir without caching', () => {
    const block = /location = \/config\.js \{([^}]*)\}/.exec(tpl)?.[1] ?? '';
    expect(block).toContain('alias /tmp/tim/config.js;');
    expect(block).toContain('expires -1;');
  });

  it('the image includes the rendered conf from the runtime dir', () => {
    expect(dockerfile).toContain("'include /tmp/tim/nginx.conf;' >/etc/nginx/conf.d/default.conf");
    expect(dockerfile).not.toMatch(/chown[^\n]*(101|nginx):[^\n]*(conf\.d|html)/);
    expect(dockerfile).toContain('chown root:root /etc/nginx/conf.d');
  });
});

describe('nginx template headers', () => {
  const tpl = readFileSync(join(docker, 'nginx.conf.template'), 'utf8');

  it('sets the baseline security headers and hides the version', () => {
    expect(tpl).toContain('server_tokens off;');
    expect(tpl).toContain('add_header X-Content-Type-Options "nosniff" always;');
    expect(tpl).toContain('add_header Referrer-Policy');
    expect(tpl).toContain('add_header Strict-Transport-Security $tim_hsts always;');
  });

  it('allows framing from the same origin only', () => {
    expect(tpl).toContain('add_header X-Frame-Options "SAMEORIGIN" always;');
    expect(tpl).not.toContain('X-Frame-Options "DENY"');
  });

  it('does not use add_header inside locations', () => {
    const locations = tpl.slice(tpl.indexOf('location '));
    expect(locations).not.toMatch(/add_header/);
  });
});
