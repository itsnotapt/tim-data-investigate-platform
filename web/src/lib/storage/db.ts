import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Annotations } from '../api/annotations';
import type { ColumnView, DisplayComponent, QueryOption, RowResult } from './types';

/** The app's IndexedDB database. */
const TIM_DB_NAME = 'tim';
const TIM_DB_VERSION = 2;

export const STORE = {
  displayComponents: 'display_components',
  rowResults: 'row_results',
  columnViews: 'column_views',
  queryOptions: 'query_options',
  annotations: 'annotations',
  annotationSync: 'annotation_sync',
} as const;

interface TimDbSchema extends DBSchema {
  display_components: { key: string; value: DisplayComponent };
  /** Key = display component uuid; out-of-line key, value is the row array. */
  row_results: { key: string; value: RowResult[] };
  column_views: { key: string; value: ColumnView };
  /** Key = template uuid; out-of-line key. */
  query_options: { key: string; value: QueryOption };
  /**
   * Each `id`'s annotations, keyed by `id`. An `id` whose annotations were all removed stays, as a
   * tombstone with its version.
   */
  annotations: { key: string; value: Annotations };
  /** Key = `cursor`; out-of-line key, value is the change feed version read up to. */
  annotation_sync: { key: string; value: number };
}

export type TimDb = IDBPDatabase<TimDbSchema>;

let dbPromise: Promise<TimDb> | null = null;

/** Opens (once) and returns the `tim` database. */
export function openTimDb(): Promise<TimDb> {
  if (!dbPromise) {
    const opening = openDB<TimDbSchema>(TIM_DB_NAME, TIM_DB_VERSION, {
      upgrade(db, oldVersion) {
        // Forward-only: add `if (oldVersion < N)` blocks for later versions.
        if (oldVersion < 1) {
          db.createObjectStore(STORE.displayComponents, { keyPath: 'componentUuid' });
          db.createObjectStore(STORE.rowResults);
          db.createObjectStore(STORE.columnViews, { keyPath: 'uuid' });
          db.createObjectStore(STORE.queryOptions);
        }
        if (oldVersion < 2) {
          db.createObjectStore(STORE.annotations, { keyPath: 'id' });
          db.createObjectStore(STORE.annotationSync);
        }
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
