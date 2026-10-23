import type { CatalogueAction, InstanceConnection, Preset } from '../../lib/api';
import { initialParams, isUnset } from '../action-tab/paramValues';
import { presetValues } from './openPreset';

/** A preset resolved from the rows: the tab's params, and the params it still waits for. */
export interface PresetPivotParams {
  params: Record<string, unknown>;
  missing: Record<string, string | null>;
}

/** A preset that pivots from the rows, but not with these: why. */
export interface PresetPivotDisabled {
  disabled: string;
}

/** The first non-empty value of `columns` in `row`: `null`, `undefined` and `""` are empty. */
const firstValue = (row: Record<string, unknown>, columns: readonly string[]): unknown =>
  columns
    .filter((c) => Object.hasOwn(row, c))
    .map((c) => row[c])
    .find((v) => v !== null && v !== undefined && v !== '');

/** The values in first-seen order, each once; JSON values are equal when their text is. */
function distinct(values: readonly unknown[]): unknown[] {
  const seen = new Map<string, unknown>();
  for (const value of values) {
    const key = JSON.stringify(value);
    if (!seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()];
}

/**
 * Pivots from `rows` with `preset` of `action`, resolved in the browser. The preset pivots when
 * it has From row inputs, each with columns that every row has one of; otherwise `null`. Each
 * input takes the first non-empty of its columns in each row. A many-valued param takes the
 * distinct values, a single-valued one the value the rows agree on: when they disagree, the
 * pivot is disabled with the reason. A required param still unset is missing, as when the server
 * resolves a pivot into the action.
 */
export function presetPivot(
  preset: Preset,
  action: CatalogueAction,
  rows: readonly Record<string, unknown>[],
  connections: readonly InstanceConnection[],
): PresetPivotParams | PresetPivotDisabled | null {
  const fromRow = (preset.inputs ?? []).flatMap((i) => (i.fixed ? [] : [i]));
  const pivots =
    fromRow.length > 0 &&
    fromRow.every(
      (i) =>
        i.fromColumns.length > 0 &&
        rows.every((row) => i.fromColumns.some((c) => Object.hasOwn(row, c))),
    );
  if (!pivots) return null;
  const params = { ...initialParams(action, connections), ...presetValues(preset) };
  for (const input of fromRow) {
    const values = distinct(
      rows.map((row) => firstValue(row, input.fromColumns)).filter((v) => v !== undefined),
    );
    const param = action.params.find((p) => p.name === input.name);
    if (values.length === 0) continue;
    if (param?.many) {
      params[input.name] = values;
    } else if (values.length === 1) {
      params[input.name] = values[0];
    } else {
      const title = param?.title ?? input.name;
      return { disabled: `The ${rows.length} selected rows have different ${title} values` };
    }
  }
  const missing = Object.fromEntries(
    action.params.flatMap((p) => (p.required && isUnset(params[p.name]) ? [[p.name, null]] : [])),
  );
  return { params, missing };
}
