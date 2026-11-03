import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import type { CatalogueAction, Preset } from '../../lib/api';
import { initialParams } from '../action-tab/paramValues';
import { useInstanceStore } from '../instance';
import { fromAction, fromPreset } from '../action-tab/model';
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
      const tabId = store
        .getState()
        .createTab({ parentId: null, content: fromAction(action, params) });
      void navigate(`/view/${tabId}`);
      return tabId;
    },
    [store, navigate],
  );
  const createFromPreset = useCallback(
    (preset: Preset, action: CatalogueAction) => {
      const connections = useInstanceStore.getState().instance?.connections ?? [];
      const opening = presetTabParams(preset, action, connections);
      const tabId = store.getState().createTab({
        parentId: null,
        content: fromPreset(preset, action, opening),
      });
      void navigate(`/view/${tabId}`);
      return tabId;
    },
    [store, navigate],
  );
  return { createFromAction, createFromPreset };
}
