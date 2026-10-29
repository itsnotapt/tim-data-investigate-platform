import { create } from 'zustand';
import { defaultViewsDao, type DefaultView } from '../../lib/storage';
import type { ColumnViewScope } from './ranking';

const PRESET = 'preset:';

/**
 * The key of a tab's default view: its preset's, else its action's. A preset never falls back.
 */
export const scopeKey = ({ action, presetId }: ColumnViewScope) =>
  presetId ? `${PRESET}${presetId}` : `action:${action}`;

interface DefaultViewsState {
  /** The signed-in analyst whose entries are loaded. */
  analyst: string | null;
  /** By scope key. */
  defaults: Record<string, DefaultView>;

  load(analyst: string): Promise<void>;
  /** New tabs for `scope` open with the column view `view`. */
  makeDefault(scope: ColumnViewScope, view: { viewId: string; name: string }): Promise<void>;
  /** New tabs for `scope` open with the Built-in view. */
  clear(scope: ColumnViewScope): Promise<void>;
  /** Drops the entries of presets not in `presetIds`. */
  dropPresetsExcept(presetIds: ReadonlySet<string>): Promise<void>;
}

/** The default views per preset and action, for the signed-in analyst in this browser. */
export const useDefaultViewsStore = create<DefaultViewsState>()((set, get) => {
  const remove = async (key: string) => {
    const { analyst, defaults } = get();
    if (!analyst || !defaults[key]) return;
    set({ defaults: Object.fromEntries(Object.entries(defaults).filter(([k]) => k !== key)) });
    await defaultViewsDao.delete(analyst, key);
  };
  return {
    analyst: null,
    defaults: {},
    async load(analyst) {
      const entries = await defaultViewsDao.list(analyst);
      set({ analyst, defaults: Object.fromEntries(entries.map((e) => [e.scope, e])) });
    },
    async makeDefault(scope, { viewId, name }) {
      const { analyst, defaults } = get();
      if (!analyst) return;
      const entry: DefaultView = { analyst, scope: scopeKey(scope), viewId, name };
      set({ defaults: { ...defaults, [entry.scope]: entry } });
      await defaultViewsDao.put(entry);
    },
    clear: (scope) => remove(scopeKey(scope)),
    async dropPresetsExcept(presetIds) {
      const gone = Object.keys(get().defaults).filter(
        (key) => key.startsWith(PRESET) && !presetIds.has(key.slice(PRESET.length)),
      );
      for (const key of gone) await remove(key);
    },
  };
});
