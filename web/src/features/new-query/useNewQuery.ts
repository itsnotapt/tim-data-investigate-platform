import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import type { CatalogueAction, Preset } from '../../lib/api';
import { initialParams } from '../action-tab/paramValues';
import { useInstanceStore } from '../instance';
import { presetTabParams } from '../presets';
import { useTabsStore, type TabsStore } from '../tabs';

export interface NewQueryActions {
  /**
   * New root action tab with the action's defaults as its params, and the connection of each
   * connection param that has only one (not run).
   */
  createFromAction: (action: CatalogueAction) => string;
  /**
   * New root action tab from a preset of `action`, titled with the preset's name (not run). Its
   * From row inputs that are unset wait to be filled in.
   */
  createFromPreset: (preset: Preset, action: CatalogueAction) => string;
}

/** Creates tabs from the New menu (W1) and navigates to them. */
export function useNewQuery(store: TabsStore = useTabsStore): NewQueryActions {
  const navigate = useNavigate();
  const createFromAction = useCallback(
    (action: CatalogueAction) => {
      const connections = useInstanceStore.getState().instance?.connections ?? [];
      const params = initialParams(action, connections);
      const uuid = store.getState().createTab({
        componentName: 'ActionResult',
        parentUuid: null,
        title: action.name,
        params: { action: action.key, params },
      });
      void navigate(`/view/${uuid}`);
      return uuid;
    },
    [store, navigate],
  );
  const createFromPreset = useCallback(
    (preset: Preset, action: CatalogueAction) => {
      const connections = useInstanceStore.getState().instance?.connections ?? [];
      const { params, missing } = presetTabParams(preset, action, connections);
      const uuid = store.getState().createTab({
        componentName: 'ActionResult',
        parentUuid: null,
        title: preset.name,
        params: { action: action.key, params, presetId: preset.presetId },
        ...(preset.idColumn ? { state: { idColumn: preset.idColumn } } : {}),
      });
      if (Object.keys(missing).length > 0)
        store.getState().updateState(uuid, { pivotMissing: missing });
      void navigate(`/view/${uuid}`);
      return uuid;
    },
    [store, navigate],
  );
  return { createFromAction, createFromPreset };
}
