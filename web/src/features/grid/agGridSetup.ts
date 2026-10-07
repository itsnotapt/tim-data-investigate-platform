import { ModuleRegistry } from 'ag-grid-community';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';

let modulesRegistered = false;

/** Registers every Enterprise module (AG Grid Enterprise only). Idempotent. */
export function registerAgGridModules(): void {
  if (modulesRegistered) return;
  ModuleRegistry.registerModules([AllEnterpriseModule]);
  modulesRegistered = true;
}

/**
 * Call once at startup: `initAgGrid(getConfig())` (done in `src/app/main.tsx`). Applies `agGridLicenseKey` when present; without it AG Grid runs as a trial (watermark).
 */
export function initAgGrid(config: { agGridLicenseKey?: string | undefined }): void {
  registerAgGridModules();
  if (config.agGridLicenseKey) LicenseManager.setLicenseKey(config.agGridLicenseKey);
}
