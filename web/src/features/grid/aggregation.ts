/** `dcount`: distinct non-empty values, flattening array values (legacy `KustoPivot.vue` aggFuncs). */
export function dcount(params: { values: readonly unknown[] }): number {
  const flat = params.values.flatMap((v) => (Array.isArray(v) ? (v as unknown[]) : [v]));
  return new Set(flat.filter((v) => v !== null && v !== undefined && v !== '')).size;
}

export const aggFuncs = { dcount };
