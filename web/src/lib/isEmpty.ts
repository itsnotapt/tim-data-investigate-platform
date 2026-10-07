/**
 * True for '', undefined, null, empty arrays and empty plain objects.
 * Whitespace-only strings, 0 and false are NOT empty.
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
