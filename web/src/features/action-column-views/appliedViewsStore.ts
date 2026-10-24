import { create } from 'zustand';
import { appliedViewsDao, type AppliedView } from '../../lib/storage';
import type { ColumnViewScope } from './ranking';

const PRESET = 'preset:';

/**
 * The key of a tab's applied column view: its preset's, else its action's. A preset never falls
 * back.
 */
export const scopeKey = ({ action, presetId }: ColumnViewScope) =>
  presetId ? `${PRESET}${presetId}` : `action:${action}`;

interface AppliedViewsState {
  /** The signed-in analyst whose entries are loaded. */
  analyst: string | null;
  /** By scope key. */
  applied: Record<string, AppliedView>;

  load(analyst: string): Promise<void>;
  /** New tabs for `scope` start with the column view `view`. */
  apply(scope: ColumnViewScope, view: { viewId: string; name: string }): Promise<void>;
  /** New tabs for `scope` start with the action default. */
  clear(scope: ColumnViewScope): Promise<void>;
  /** Drops the entries of presets not in `presetIds`. */
  dropPresetsExcept(presetIds: ReadonlySet<string>): Promise<void>;
}

/** The column views applied per preset and action, for the signed-in analyst in this browser. */
export const useAppliedViewsStore = create<AppliedViewsState>()((set, get) => {
  const remove = async (key: string) => {
    const { analyst, applied } = get();
    if (!analyst || !applied[key]) return;
    set({ applied: Object.fromEntries(Object.entries(applied).filter(([k]) => k !== key)) });
    await appliedViewsDao.delete(analyst, key);
  };
  return {
    analyst: null,
    applied: {},
    async load(analyst) {
      const entries = await appliedViewsDao.list(analyst);
      set({ analyst, applied: Object.fromEntries(entries.map((e) => [e.scope, e])) });
    },
    async apply(scope, { viewId, name }) {
      const { analyst, applied } = get();
      if (!analyst) return;
      const entry: AppliedView = { analyst, scope: scopeKey(scope), viewId, name };
      set({ applied: { ...applied, [entry.scope]: entry } });
      await appliedViewsDao.put(entry);
    },
    clear: (scope) => remove(scopeKey(scope)),
    async dropPresetsExcept(presetIds) {
      const gone = Object.keys(get().applied).filter(
        (key) => key.startsWith(PRESET) && !presetIds.has(key.slice(PRESET.length)),
      );
      for (const key of gone) await remove(key);
    },
  };
});
