/**
 * In-memory column state per tab (not persisted).
 * The grid saves it when its tab is hidden or unmounted and restores it when shown or re-created.
 */
const states = new Map<string, unknown[]>();

export const tabColumnState = {
  get: (key: string): unknown[] | undefined => states.get(key),
  set: (key: string, state: unknown[]): void => void states.set(key, state),
  delete: (key: string): void => void states.delete(key),
  clear: (): void => states.clear(),
};
