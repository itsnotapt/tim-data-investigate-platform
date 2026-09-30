// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Security regression tests for the container entrypoint and the nginx template (P5-09).
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
      TIM_HTML_DIR: dir,
      TIM_NGINX_TEMPLATE: join(docker, 'nginx.conf.template'),
      TIM_NGINX_CONF: join(dir, 'default.conf'),
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
    conf: read('default.conf'),
  };
}

describe.skipIf(!hasTools)('web container entrypoint (S-W03, S-W02)', () => {
  it('S-W03: hostile env values cannot break out of config.js', () => {
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

  it('S-W02: renders a CSP without script unsafe-inline and with same-origin connect-src', () => {
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

  it('S-W02: a cross-origin API_BASEPATH is allowed in connect-src, junk is refused', () => {
    const ok = runEntrypoint({ API_BASEPATH: 'https://api.example.com:8443/base' });
    expect(ok.conf).toContain('https://login.microsoftonline.com https://api.example.com:8443;');
    const bad = runEntrypoint({ API_BASEPATH: 'https://a.example; script-src *' });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('API_BASEPATH');
  });
});

describe('nginx template headers (S-W02, S-W05)', () => {
  const tpl = readFileSync(join(docker, 'nginx.conf.template'), 'utf8');

  it('sets the baseline security headers and hides the version', () => {
    expect(tpl).toContain('server_tokens off;');
    expect(tpl).toContain('add_header X-Content-Type-Options "nosniff" always;');
    expect(tpl).toContain('add_header Referrer-Policy');
    expect(tpl).toContain('add_header Strict-Transport-Security $tim_hsts always;');
  });

  it('S-W05: framing is same-origin only (MSAL silent iframe needs /blank.html)', () => {
    expect(tpl).toContain('add_header X-Frame-Options "SAMEORIGIN" always;');
    expect(tpl).not.toContain('X-Frame-Options "DENY"');
  });

  it('does not use add_header inside locations (would drop the server-level headers)', () => {
    const locations = tpl.slice(tpl.indexOf('location '));
    expect(locations).not.toMatch(/add_header/);
  });
});
