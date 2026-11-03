import type { Annotations } from '../api/annotations';
import { openTimDb, STORE } from './db';
import type { DefaultView, RowResult, Tab } from './types';

export const tabsDao = {
  async getAll(): Promise<Tab[]> {
    return (await openTimDb()).getAll(STORE.tabs);
  },
  async get(id: string): Promise<Tab | undefined> {
    return (await openTimDb()).get(STORE.tabs, id);
  },
  async put(tab: Tab): Promise<void> {
    // `children` is in-memory only; never persist it.
    const record: Record<string, unknown> = { ...tab };
    delete record.children;
    await (await openTimDb()).put(STORE.tabs, record as unknown as Tab);
  },
  async deleteMany(ids: readonly string[]): Promise<void> {
    const tx = (await openTimDb()).transaction(STORE.tabs, 'readwrite');
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  },
};

export const rowResultsDao = {
  /** Returns `[]` when nothing is stored. */
  async get(tabId: string): Promise<RowResult[]> {
    return (await (await openTimDb()).get(STORE.rowResults, tabId)) ?? [];
  },
  async put(tabId: string, rows: RowResult[]): Promise<void> {
    await (await openTimDb()).put(STORE.rowResults, rows, tabId);
  },
  async delete(tabId: string): Promise<void> {
    await (await openTimDb()).delete(STORE.rowResults, tabId);
  },
  async deleteMany(tabIds: readonly string[]): Promise<void> {
    const tx = (await openTimDb()).transaction(STORE.rowResults, 'readwrite');
    await Promise.all([...tabIds.map((id) => tx.store.delete(id)), tx.done]);
  },
};

export const defaultViewsDao = {
  /** The analyst's default views, in any order. */
  async list(analyst: string): Promise<DefaultView[]> {
    return (await openTimDb()).getAllFromIndex(STORE.defaultViews, 'analyst', analyst);
  },
  async put(entry: DefaultView): Promise<void> {
    await (await openTimDb()).put(STORE.defaultViews, entry);
  },
  async delete(analyst: string, scope: string): Promise<void> {
    await (await openTimDb()).delete(STORE.defaultViews, [analyst, scope]);
  },
};

export const annotationsDao = {
  /** The stored annotations of those of `ids` that have any, tombstones included. */
  async getMany(ids: Iterable<string>): Promise<Map<string, Annotations>> {
    const tx = (await openTimDb()).transaction(STORE.annotations, 'readonly');
    const [found] = await Promise.all([
      Promise.all([...new Set(ids)].map((id) => tx.store.get(id))),
      tx.done,
    ]);
    return new Map(found.filter((a) => a !== undefined).map((a) => [a.id, a]));
  },
  /** Stores each of `list` newer than the stored one, in one transaction; returns those stored. */
  async putNewer(list: readonly Annotations[]): Promise<Annotations[]> {
    const tx = (await openTimDb()).transaction(STORE.annotations, 'readwrite');
    const newest = new Map<string, Annotations>();
    for (const a of list) {
      const seen = newest.get(a.id);
      if (!seen || a.version > seen.version) newest.set(a.id, a);
    }
    const stored = await Promise.all(
      [...newest.values()].map(async (a) => {
        const current = await tx.store.get(a.id);
        if (current && current.version >= a.version) return null;
        await tx.store.put(a);
        return a;
      }),
    );
    await tx.done;
    return stored.filter((a) => a !== null);
  },
};

const CURSOR = 'cursor';

export const annotationSyncDao = {
  /** The change feed version read up to; `0` before the first read. */
  async getCursor(): Promise<number> {
    return (await (await openTimDb()).get(STORE.annotationSync, CURSOR)) ?? 0;
  },
  async putCursor(version: number): Promise<void> {
    await (await openTimDb()).put(STORE.annotationSync, version, CURSOR);
  },
};
