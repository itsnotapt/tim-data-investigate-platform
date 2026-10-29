import { usePresetsStore } from '../presets';
import { useDefaultViewsStore } from './defaultViewsStore';

/**
 * Loads the analyst's default views, then drops the entries of presets that are gone. When
 * the presets can't be listed the entries stay until a later load.
 */
export async function loadDefaultViews(analyst: string): Promise<void> {
  await useDefaultViewsStore.getState().load(analyst);
  const presets = usePresetsStore.getState();
  await presets.refresh();
  const { presets: listed, error } = usePresetsStore.getState();
  if (error) return;
  await useDefaultViewsStore.getState().dropPresetsExcept(new Set(listed.map((p) => p.presetId)));
}
