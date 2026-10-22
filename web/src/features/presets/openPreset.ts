import type { CatalogueAction, InstanceConnection, Preset } from '../../lib/api';
import { initialParams, stillMissing } from '../action-tab/paramValues';

/** The values a preset sets: its params and its fixed inputs' values. */
export const presetValues = (preset: Preset): Record<string, unknown> => ({
  ...preset.params,
  ...Object.fromEntries((preset.inputs ?? []).flatMap((i) => (i.fixed ? [[i.name, i.value]] : []))),
});

/**
 * What a tab opened from `preset` starts with: the action's defaults, then the preset's params and
 * fixed values. Each From row input that is still unset is missing, as after a pivot.
 */
export function presetTabParams(
  preset: Preset,
  action: CatalogueAction,
  connections: readonly InstanceConnection[],
): { params: Record<string, unknown>; missing: Record<string, null> } {
  const inputs = preset.inputs ?? [];
  const params = { ...initialParams(action, connections), ...presetValues(preset) };
  const fromRow = Object.fromEntries(inputs.flatMap((i) => (i.fixed ? [] : [[i.name, null]])));
  const missing = Object.fromEntries(stillMissing(fromRow, params).map((name) => [name, null]));
  return { params, missing };
}
