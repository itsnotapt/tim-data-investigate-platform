import { rowResultsDao, tabsDao } from '../../lib/storage';
import type { Tab } from './types';

/** Storage boundary of the tab store; swap it in tests or for import/export. */
export interface TabPersistence {
  loadAll(): Promise<Tab[]>;
  save(tab: Tab): Promise<void>;
  /** Removes the tabs and their row results. */
  remove(ids: readonly string[]): Promise<void>;
}

export const indexedDbTabPersistence: TabPersistence = {
  loadAll: () => tabsDao.getAll(),
  save: (tab) => tabsDao.put(tab),
  async remove(ids) {
    // Row results of every removed tab go too.
    await Promise.all([tabsDao.deleteMany(ids), rowResultsDao.deleteMany(ids)]);
  },
};

/**
 * Debounced, serialised writer. Saves are coalesced per tab; all storage calls run one after
 * another so a late save can never resurrect a removed tab.
 */
export class PersistQueue {
  private dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly persistence: TabPersistence,
    private readonly getTab: (id: string) => Tab | undefined,
    private readonly debounceMs: number,
    private readonly onError: (error: unknown) => void = (e) =>
      console.error('Tab persistence failed', e),
  ) {}

  schedule(id: string): void {
    this.dirty.add(id);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  /** Write every pending tab now. Resolves when storage is up to date. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const ids = [...this.dirty];
    this.dirty.clear();
    return this.enqueue(async () => {
      for (const id of ids) {
        const tab = this.getTab(id); // skip tabs removed meanwhile
        if (tab) await this.persistence.save(tab);
      }
    });
  }

  remove(ids: readonly string[]): Promise<void> {
    for (const id of ids) this.dirty.delete(id);
    return this.enqueue(() => this.persistence.remove(ids));
  }

  /** Drop pending (unwritten) saves. */
  discard(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.dirty.clear();
  }

  /** Wait for in-flight work without forcing a write. */
  idle(): Promise<void> {
    return this.chain;
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.chain.then(job);
    this.chain = run.catch((e: unknown) => this.onError(e));
    return this.chain;
  }
}
