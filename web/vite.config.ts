/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // blank.html is the MSAL popup redirect target (src/lib/auth/redirectBridge.ts).
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        blank: resolve(import.meta.dirname, 'blank.html'),
      },
      output: {
        // AG Grid (lazy, only loaded with a results grid) in its own chunk, so app releases don't
        // invalidate it in the browser cache. Monaco is already split by its dynamic imports.
        codeSplitting: {
          groups: [
            {
              name: 'ag-grid',
              test: /[\\/]node_modules[\\/](ag-grid-|ag-stack)/,
              // Shared deps (React, ...) stay where they are, so the group isn't loaded eagerly.
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
  // Monaco workers import each other / share chunks; IIFE workers can't code-split.
  worker: { format: 'es' },
  // @kusto/monaco-kusto's language service bundle references Node's `global`.
  define: { global: 'globalThis' },
  optimizeDeps: {
    // Only imported from the worker entry src/lib/monaco/kusto.worker.ts, which the dependency
    // scan doesn't reach; pre-bundled so Vite doesn't re-optimise and reload the page at first use.
    include: [
      '@kusto/monaco-kusto/release/esm/kusto.worker',
      'monaco-editor/esm/vs/editor/editor.worker',
    ],
  },
  server: {
    // Dev loop: forward API calls to the api run locally.
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    css: false,
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
