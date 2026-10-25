import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Annotations } from '../api/annotations';
import type { AppliedView, ColumnView, DisplayComponent, RowResult } from './types';

/** The app's IndexedDB database. */
const TIM_DB_NAME = 'tim';
const TIM_DB_VERSION = 4;

export const STORE = {
  displayComponents: 'display_components',
  rowResults: 'row_results',
  columnViews: 'column_views',
  annotations: 'annotations',
  annotationSync: 'annotation_sync',
  appliedViews: 'applied_views',
} as const;

interface TimDbSchema extends DBSchema {
  display_components: { key: string; value: DisplayComponent };
  /** Key = display component uuid; out-of-line key, value is the row array. */
  row_results: { key: string; value: RowResult[] };
  column_views: { key: string; value: ColumnView };
  /**
   * Each `id`'s annotations, keyed by `id`. An `id` whose annotations were all removed stays, as a
   * tombstone with its version.
   */
  annotations: { key: string; value: Annotations };
  /** Key = `cursor`; out-of-line key, value is the change feed version read up to. */
  annotation_sync: { key: string; value: number };
  /** Key = `[analyst, scope]`. */
  applied_views: { key: [string, string]; value: AppliedView; indexes: { analyst: string } };
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
        }
        if (oldVersion < 2) {
          db.createObjectStore(STORE.annotations, { keyPath: 'id' });
          db.createObjectStore(STORE.annotationSync);
        }
        if (oldVersion < 3) {
          const applied = db.createObjectStore(STORE.appliedViews, {
            keyPath: ['analyst', 'scope'],
          });
          applied.createIndex('analyst', 'analyst');
        }
        if (oldVersion < 4) {
          // Versions 1 to 3 had a `query_options` store, which the schema no longer names.
          const untyped = db as unknown as IDBPDatabase;
          if (untyped.objectStoreNames.contains('query_options')) {
            untyped.deleteObjectStore('query_options');
          }
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
