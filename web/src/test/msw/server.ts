import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

/** Shared MSW server. Add per-test handlers with `server.use(...)`; they reset after each test. */
export const server = setupServer();

/** Call once at the top of a test file: starts/stops the server, fails on unhandled requests. */
export function setupMswServer(): typeof server {
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}
