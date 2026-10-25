import type { Annotations } from '../api/annotations';
import { openTimDb, STORE } from './db';
import type { AppliedView, ColumnView, DisplayComponent, RowResult } from './types';

export const displayComponentsDao = {
  async getAll(): Promise<DisplayComponent[]> {
    return (await openTimDb()).getAll(STORE.displayComponents);
  },
  async get(componentUuid: string): Promise<DisplayComponent | undefined> {
    return (await openTimDb()).get(STORE.displayComponents, componentUuid);
  },
  async put(component: DisplayComponent): Promise<void> {
    // `children` is in-memory only; never persist it.
    const record: Record<string, unknown> = { ...component };
    delete record.children;
    await (await openTimDb()).put(STORE.displayComponents, record as unknown as DisplayComponent);
  },
  async deleteMany(componentUuids: readonly string[]): Promise<void> {
    const tx = (await openTimDb()).transaction(STORE.displayComponents, 'readwrite');
    await Promise.all([...componentUuids.map((id) => tx.store.delete(id)), tx.done]);
  },
};

export const rowResultsDao = {
  /** Returns `[]` when nothing is stored. */
  async get(componentUuid: string): Promise<RowResult[]> {
    return (await (await openTimDb()).get(STORE.rowResults, componentUuid)) ?? [];
  },
  async put(componentUuid: string, rows: RowResult[]): Promise<void> {
    await (await openTimDb()).put(STORE.rowResults, rows, componentUuid);
  },
  async delete(componentUuid: string): Promise<void> {
    await (await openTimDb()).delete(STORE.rowResults, componentUuid);
  },
  async deleteMany(componentUuids: readonly string[]): Promise<void> {
    const tx = (await openTimDb()).transaction(STORE.rowResults, 'readwrite');
    await Promise.all([...componentUuids.map((id) => tx.store.delete(id)), tx.done]);
  },
};

export const columnViewsDao = {
  /** Sorted by name. */
  async list(): Promise<ColumnView[]> {
    const all = await (await openTimDb()).getAll(STORE.columnViews);
    return all.sort((a, b) => a.name.localeCompare(b.name));
  },
  async put(view: ColumnView): Promise<void> {
    await (await openTimDb()).put(STORE.columnViews, view);
  },
  /** Returns the updated view, or `undefined` if `uuid` does not exist. */
  async rename(uuid: string, name: string): Promise<ColumnView | undefined> {
    const tx = (await openTimDb()).transaction(STORE.columnViews, 'readwrite');
    const existing = await tx.store.get(uuid);
    if (!existing) {
      await tx.done;
      return undefined;
    }
    const updated = { ...existing, name };
    await tx.store.put(updated);
    await tx.done;
    return updated;
  },
  async delete(uuid: string): Promise<void> {
    await (await openTimDb()).delete(STORE.columnViews, uuid);
  },
};

export const appliedViewsDao = {
  /** The analyst's applied views, in any order. */
  async list(analyst: string): Promise<AppliedView[]> {
    return (await openTimDb()).getAllFromIndex(STORE.appliedViews, 'analyst', analyst);
  },
  async put(applied: AppliedView): Promise<void> {
    await (await openTimDb()).put(STORE.appliedViews, applied);
  },
  async delete(analyst: string, scope: string): Promise<void> {
    await (await openTimDb()).delete(STORE.appliedViews, [analyst, scope]);
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
