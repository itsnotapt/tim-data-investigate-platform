import type { StoredError } from './types';

/**
 * Reduce anything thrown to a serialisable `{message, code?}`.
 * Never keeps stacks, causes or class instances.
 */
export function toStoredError(error: unknown): StoredError | null {
  if (error === null || error === undefined) return null;
  if (typeof error === 'string') return { message: error };
  if (typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown };
    const message = typeof e.message === 'string' ? e.message : safeString(error);
    const out: StoredError = { message };
    if (typeof e.code === 'string' || typeof e.code === 'number') out.code = String(e.code);
    return out;
  }
  return { message: safeString(error) };
}

function safeString(value: unknown): string {
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return 'Unknown error';
    }
  }
  return typeof value === 'function' ? 'Unknown error' : `${value as string}`;
}
