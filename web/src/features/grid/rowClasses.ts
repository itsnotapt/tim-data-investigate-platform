import type { RowClassRules } from 'ag-grid-community';

export const DETERMINATIONS = ['malicious', 'suspicious', 'benign'] as const;
export type Determination = (typeof DETERMINATIONS)[number];

/** Class names match the legacy CSS (`KustoPivot.vue` style block). */
export const determinationClass = (d: Determination) => `ag-tag-${d}`;

/** Reads `TagEvent.Determination` (lower-cased by the tagging code) from a row. */
export function getDetermination(data: unknown): Determination | null {
  const tag = (data as { TagEvent?: { Determination?: unknown } } | null | undefined)?.TagEvent;
  const value = tag?.Determination;
  return DETERMINATIONS.find((d) => d === value) ?? null;
}

export const rowClassRules: RowClassRules = Object.fromEntries(
  DETERMINATIONS.map((d) => [
    determinationClass(d),
    (params: { data?: unknown }) => getDetermination(params.data) === d,
  ]),
);
