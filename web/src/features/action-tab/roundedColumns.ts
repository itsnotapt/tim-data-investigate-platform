import { createContext } from 'react';
import type { RunRow } from '../../lib/api';

/** Whether `value` is a whole number beyond ±(2^53 − 1), which the browser holds rounded. */
const isRounded = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value);

/** Of the columns `names`, the ones with a whole number beyond ±(2^53 − 1) in `rows`. */
export function roundedColumns(rows: readonly RunRow[], names: readonly string[]): Set<string> {
  return new Set(names.filter((name) => rows.some((row) => isRounded(row.data[name]))));
}

/** The `number` columns whose headers warn that they hold rounded whole numbers. */
export const RoundedColumnsContext = createContext<ReadonlySet<string>>(new Set());
