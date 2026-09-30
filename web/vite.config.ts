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
    },
  },
  server: {
    // Dev loop: forward API calls to the api run locally (see docs/rewrite/local-dev.md).
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    css: false,
  },
});
