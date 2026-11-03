import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Annotations } from '../api/annotations';
import type { DefaultView, RowResult, Tab } from './types';

/** The app's IndexedDB database. */
const TIM_DB_NAME = 'tim';
const TIM_DB_VERSION = 6;

export const STORE = {
  tabs: 'tabs',
  rowResults: 'row_results',
  annotations: 'annotations',
  annotationSync: 'annotation_sync',
  /** Default views. The store is named `applied_views`. */
  defaultViews: 'applied_views',
} as const;

interface TimDbSchema extends DBSchema {
  tabs: { key: string; value: Tab };
  /** Key = tab id; out-of-line key, value is the row array. */
  row_results: { key: string; value: RowResult[] };
  /**
   * Each `id`'s annotations, keyed by `id`. An `id` whose annotations were all removed stays, as a
   * tombstone with its version.
   */
  annotations: { key: string; value: Annotations };
  /** Key = `cursor`; out-of-line key, value is the change feed version read up to. */
  annotation_sync: { key: string; value: number };
  /** Key = `[analyst, scope]`. */
  applied_views: { key: [string, string]; value: DefaultView; indexes: { analyst: string } };
}

export type TimDb = IDBPDatabase<TimDbSchema>;

let dbPromise: Promise<TimDb> | null = null;

/** Opens (once) and returns the `tim` database. */
export function openTimDb(): Promise<TimDb> {
  if (!dbPromise) {
    const opening = openDB<TimDbSchema>(TIM_DB_NAME, TIM_DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        // Forward-only: add `if (oldVersion < N)` blocks for later versions.
        if (oldVersion < 1) {
          db.createObjectStore(STORE.rowResults);
        }
        if (oldVersion < 2) {
          db.createObjectStore(STORE.annotations, { keyPath: 'id' });
          db.createObjectStore(STORE.annotationSync);
        }
        if (oldVersion < 3) {
          const defaultViews = db.createObjectStore(STORE.defaultViews, {
            keyPath: ['analyst', 'scope'],
          });
          defaultViews.createIndex('analyst', 'analyst');
        }
        if (oldVersion < 4) {
          // Versions 1 to 3 had a `query_options` store, which the schema no longer names.
          const untyped = db as unknown as IDBPDatabase;
          if (untyped.objectStoreNames.contains('query_options')) {
            untyped.deleteObjectStore('query_options');
          }
        }
        if (oldVersion < 5) {
          // Versions 1 to 4 had a `column_views` store, which the schema no longer names.
          const untyped = db as unknown as IDBPDatabase;
          if (untyped.objectStoreNames.contains('column_views')) {
            untyped.deleteObjectStore('column_views');
          }
        }
        if (oldVersion < 6) {
          // Versions 1 to 5 kept tabs in a `display_components` store, in a shape no longer read:
          // those tabs and their rows are dropped.
          const untyped = db as unknown as IDBPDatabase;
          if (untyped.objectStoreNames.contains('display_components')) {
            untyped.deleteObjectStore('display_components');
            void transaction.objectStore(STORE.rowResults).clear();
          }
          db.createObjectStore(STORE.tabs, { keyPath: 'id' });
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
