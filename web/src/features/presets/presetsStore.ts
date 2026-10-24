import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  createPreset,
  deletePreset,
  getPresetActionFile,
  listPresets,
  replacePreset,
  setPresetHidden,
  type Preset,
  type PresetFields,
} from '../../lib/api';

/** The `/api/presets` calls the store makes; tests pass their own. */
export interface PresetsApi {
  list(): Promise<Preset[]>;
  create(fields: PresetFields): Promise<Preset>;
  replace(presetId: string, fields: PresetFields): Promise<Preset>;
  remove(presetId: string): Promise<void>;
  setHidden(presetId: string, hidden: boolean): Promise<void>;
  actionFile(presetId: string): Promise<string>;
}

export interface PresetsState {
  /** The analyst's own presets and the shared ones, oldest first. */
  presets: Preset[];
  loaded: boolean;
  error: string | null;

  /** Refetches, so presets others shared since show up. Records the error instead of throwing. */
  refresh(): Promise<void>;
  /** Each change below throws on failure and leaves the list as it was. */
  create(fields: PresetFields): Promise<Preset>;
  replace(presetId: string, fields: PresetFields): Promise<Preset>;
  remove(presetId: string): Promise<void>;
  setHidden(presetId: string, hidden: boolean): Promise<void>;
  /** The preset as an action file, in YAML; it changes nothing. */
  actionFile(presetId: string): Promise<string>;
}

export type PresetsStore = UseBoundStore<StoreApi<PresetsState>>;

const defaultApi: PresetsApi = {
  list: () => listPresets(),
  create: (fields) => createPreset(fields),
  replace: (presetId, fields) => replacePreset(presetId, fields),
  remove: (presetId) => deletePreset(presetId),
  setHidden: (presetId, hidden) => setPresetHidden(presetId, hidden),
  actionFile: (presetId) => getPresetActionFile(presetId),
};

export function createPresetsStore({ api = defaultApi }: { api?: PresetsApi } = {}): PresetsStore {
  return create<PresetsState>()((set, get) => {
    const put = (preset: Preset) =>
      set({ presets: get().presets.map((p) => (p.presetId === preset.presetId ? preset : p)) });
    return {
      presets: [],
      loaded: false,
      error: null,
      async refresh() {
        try {
          set({ presets: await api.list(), loaded: true, error: null });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
        }
      },
      async create(fields) {
        const preset = await api.create(fields);
        set({ presets: [...get().presets, preset] });
        return preset;
      },
      async replace(presetId, fields) {
        const preset = await api.replace(presetId, fields);
        put(preset);
        return preset;
      },
      async remove(presetId) {
        await api.remove(presetId);
        set({ presets: get().presets.filter((p) => p.presetId !== presetId) });
      },
      async setHidden(presetId, hidden) {
        await api.setHidden(presetId, hidden);
        const preset = get().presets.find((p) => p.presetId === presetId);
        if (preset) put({ ...preset, hidden });
      },
      actionFile: (presetId) => api.actionFile(presetId),
    };
  });
}

/** App-wide singleton. */
export const usePresetsStore = createPresetsStore();
