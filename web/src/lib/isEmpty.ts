/**
 * Legacy `isEmptyValue` (frontend/src/helpers/utils.js:13) treats '', undefined and null as
 * empty. It also compared `val === []` / `val === {}`, which is never true (BUG-41); here empty
 * arrays and empty plain objects are empty, as the legacy code evidently intended.
 * Whitespace-only strings, 0 and false are NOT empty (as in legacy).
 */
export function isEmpty(val: unknown): boolean {
  if (val === '' || val === undefined || val === null) return true;
  if (Array.isArray(val)) return val.length === 0;
  if (typeof val === 'object') {
    const proto: unknown = Object.getPrototypeOf(val);
    if (proto === Object.prototype || proto === null) return Object.keys(val).length === 0;
  }
  return false;
}
