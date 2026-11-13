import type { CatalogueAction, InstanceConnection, Preset } from '../../lib/api';
import { initialParams, stillMissing } from '../action-tab/paramValues';
import { pillName, presetQueryParameters } from '../action-tab/queryParameters';

/**
 * The values a preset sets: its params, its fixed inputs' values and, when it has query parameters,
 * `parameters` with each one's fixed value or `null`.
 */
export function presetValues(preset: Preset): Record<string, unknown> {
  const inputs = preset.inputs ?? [];
  const parameters = presetQueryParameters(inputs);
  return {
    ...preset.params,
    ...Object.fromEntries(
      inputs.flatMap((i) => (i.fixed && i.source === 'param' ? [[i.name, i.value]] : [])),
    ),
    ...(parameters.length > 0 ? { parameters } : {}),
  };
}

/**
 * What a tab opened from `preset` starts with: the action's defaults, then the preset's params and
 * fixed values. Each From row input that is still unset is missing, as after a pivot; a query
 * parameter by its pill's name.
 */
export function presetTabParams(
  preset: Preset,
  action: CatalogueAction,
  connections: readonly InstanceConnection[],
): { params: Record<string, unknown>; missing: Record<string, null> } {
  const inputs = preset.inputs ?? [];
  const params = { ...initialParams(action, connections), ...presetValues(preset) };
  const fromRow = Object.fromEntries(
    inputs.flatMap((i) => (i.fixed || i.source !== 'param' ? [] : [[i.name, null]])),
  );
  const askedFor = [
    ...stillMissing(fromRow, params),
    ...inputs.flatMap((i) => (!i.fixed && i.source === 'queryParameter' ? [pillName(i.name)] : [])),
  ];
  const missing = Object.fromEntries(askedFor.map((name) => [name, null] as const));
  return { params, missing };
}
