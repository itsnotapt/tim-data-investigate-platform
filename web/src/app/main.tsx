import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppThemeProvider } from './AppThemeProvider';
import { ConfigError } from './ConfigError';
import { getAuthClient } from '../lib/auth';
import { getConfig } from '../lib/config/runtimeConfig';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

let element;
try {
  // Invalid runtime config, or VITE_AUTH_STUB=true in a production build: config error page.
  getConfig();
  element = <App authClient={getAuthClient()} />;
} catch (e) {
  element = <ConfigError message={e instanceof Error ? e.message : String(e)} />;
}

createRoot(root).render(
  <StrictMode>
    <AppThemeProvider>{element}</AppThemeProvider>
  </StrictMode>,
);
