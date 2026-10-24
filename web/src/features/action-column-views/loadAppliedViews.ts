import { usePresetsStore } from '../presets';
import { useAppliedViewsStore } from './appliedViewsStore';

/**
 * Loads the analyst's applied column views, then drops the entries of presets that are gone. When
 * the presets can't be listed the entries stay until a later load.
 */
export async function loadAppliedViews(analyst: string): Promise<void> {
  await useAppliedViewsStore.getState().load(analyst);
  const presets = usePresetsStore.getState();
  await presets.refresh();
  const { presets: listed, error } = usePresetsStore.getState();
  if (error) return;
  await useAppliedViewsStore.getState().dropPresetsExcept(new Set(listed.map((p) => p.presetId)));
}
