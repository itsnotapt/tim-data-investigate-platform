import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ColumnView, DisplayComponent, QueryOption, RowResult } from './types';

/**
 * The new app's own database. It never opens or reads the legacy `localforage`
 * database (Q-004: no migration).
 */
export const TIM_DB_NAME = 'tim';
export const TIM_DB_VERSION = 1;

export const STORE = {
  displayComponents: 'display_components',
  rowResults: 'row_results',
  columnViews: 'column_views',
  queryOptions: 'query_options',
} as const;

export interface TimDbSchema extends DBSchema {
  display_components: { key: string; value: DisplayComponent };
  /** Key = display component uuid; out-of-line key, value is the row array. */
  row_results: { key: string; value: RowResult[] };
  column_views: { key: string; value: ColumnView };
  /** Key = template uuid; out-of-line key. */
  query_options: { key: string; value: QueryOption };
}

export type TimDb = IDBPDatabase<TimDbSchema>;

let dbPromise: Promise<TimDb> | null = null;

/** Opens (once) and returns the `tim` database. */
export function openTimDb(): Promise<TimDb> {
  if (!dbPromise) {
    const opening = openDB<TimDbSchema>(TIM_DB_NAME, TIM_DB_VERSION, {
      upgrade(db) {
        // Forward-only: add `if (oldVersion < N)` blocks for later versions.
        db.createObjectStore(STORE.displayComponents, { keyPath: 'componentUuid' });
        db.createObjectStore(STORE.rowResults);
        db.createObjectStore(STORE.columnViews, { keyPath: 'uuid' });
        db.createObjectStore(STORE.queryOptions);
      },
      terminated() {
        dbPromise = null;
      },
    });
    dbPromise = opening;
    // Do not cache a failed open.
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null;
    });
  }
  return dbPromise;
}

/** Closes and forgets the cached connection (tests, logout). */
export async function resetTimDb(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (pending) {
    try {
      (await pending).close();
    } catch {
      // open failed; nothing to close
    }
  }
}
