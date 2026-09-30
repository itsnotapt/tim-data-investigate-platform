import { describe, expect, it } from 'vitest';
import { normalizeClusterUrl } from './clusterUrl';

describe('normalizeClusterUrl', () => {
  it('prepends https:// but never forces a kusto domain (BUG-29)', () => {
    expect(normalizeClusterUrl('contoso')).toBe('https://contoso');
    expect(normalizeClusterUrl('x.kusto.fabric.microsoft.com')).toBe(
      'https://x.kusto.fabric.microsoft.com',
    );
    expect(normalizeClusterUrl('help.kusto.chinacloudapi.cn')).toBe(
      'https://help.kusto.chinacloudapi.cn',
    );
  });
  it('keeps an existing scheme, trims and drops trailing slashes', () => {
    expect(normalizeClusterUrl('  https://help.kusto.windows.net// ')).toBe(
      'https://help.kusto.windows.net',
    );
    expect(normalizeClusterUrl('http://localhost:8080')).toBe('http://localhost:8080');
  });
  it('leaves empty input empty', () => {
    expect(normalizeClusterUrl('  ')).toBe('');
  });
});
