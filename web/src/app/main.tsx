import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ConfigError } from './ConfigError';
import { getConfig } from '../lib/config/runtimeConfig';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

let element;
try {
  getConfig();
  element = <App />;
} catch (e) {
  element = <ConfigError message={e instanceof Error ? e.message : String(e)} />;
}

createRoot(root).render(<StrictMode>{element}</StrictMode>);
