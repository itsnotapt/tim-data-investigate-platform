import { openTimDb, STORE } from './db';
import type { ColumnView, DisplayComponent, QueryOption, QueryOptions, RowResult } from './types';

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
  /** Returns `[]` when nothing is stored (fixes BUG-27: legacy threw). */
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
  /** Sorted by name, as the legacy lists were. */
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

export const queryOptionsDao = {
  /** All options keyed by template uuid. */
  async getAll(): Promise<QueryOptions> {
    const tx = (await openTimDb()).transaction(STORE.queryOptions, 'readonly');
    const [keys, values] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll(), tx.done]);
    return Object.fromEntries(keys.map((key, i) => [key, values[i] as QueryOption]));
  },
  async put(templateUuid: string, option: QueryOption): Promise<void> {
    await (await openTimDb()).put(STORE.queryOptions, option, templateUuid);
  },
};
