import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerModules = vi.fn();
const setLicenseKey = vi.fn();
const AllEnterpriseModule = { moduleName: 'AllEnterpriseModule' };

vi.mock('ag-grid-community', () => ({ ModuleRegistry: { registerModules } }));
vi.mock('ag-grid-enterprise', () => ({ AllEnterpriseModule, LicenseManager: { setLicenseKey } }));

beforeEach(() => {
  vi.resetModules();
  registerModules.mockClear();
  setLicenseKey.mockClear();
});

async function load() {
  return import('./agGridSetup');
}

describe('initAgGrid', () => {
  it('registers the Enterprise modules once however often it is called', async () => {
    const { initAgGrid } = await load();
    initAgGrid({});
    initAgGrid({});
    expect(registerModules).toHaveBeenCalledTimes(1);
    expect(registerModules).toHaveBeenCalledWith([AllEnterpriseModule]);
  });

  it('sets the licence key when one is configured', async () => {
    const { initAgGrid } = await load();
    initAgGrid({ agGridLicenseKey: 'key-1' });
    expect(setLicenseKey).toHaveBeenCalledWith('key-1');
  });

  it('does not set a licence key when none is configured', async () => {
    const { initAgGrid } = await load();
    initAgGrid({});
    initAgGrid({ agGridLicenseKey: '' });
    expect(setLicenseKey).not.toHaveBeenCalled();
  });
});
