/**
 * A run's rows so far, as pages of `size` rows in row number order. Every page but the last is
 * full, so row `n` is in page ⌊`n` / `size`⌋ at `n` mod `size`. A `PagedRows` and its pages never
 * change: each change gives a new one, which shares the pages it doesn't change.
 */
export interface PagedRows<T> {
  /** The most rows a page holds. */
  readonly size: number;
  readonly pages: readonly (readonly T[])[];
  /** The number of rows. */
  readonly length: number;
  /** The row with row number `n`; `undefined` past the rows so far. */
  at(n: number): T | undefined;
  /** Every row in one new array, in order. Linear in the number of rows. */
  flat(): T[];
}

function paged<T>(size: number, pages: readonly (readonly T[])[]): PagedRows<T> {
  const last = pages.at(-1);
  const length = last ? (pages.length - 1) * size + last.length : 0;
  return {
    size,
    pages,
    length,
    at: (n) =>
      Number.isInteger(n) && n >= 0 && n < length
        ? pages[Math.floor(n / size)]?.[n % size]
        : undefined,
    flat: () => pages.flat(),
  };
}

/** `rows` as pages of `size`. */
export function pagedRows<T>(size: number, rows: readonly T[]): PagedRows<T> {
  return withRows(paged(size, []), rows);
}

/** `rows` with `added` after the rows there were: the last page topped up, then new pages. */
export function withRows<T>(rows: PagedRows<T>, added: readonly T[]): PagedRows<T> {
  if (added.length === 0) return rows;
  const { size } = rows;
  const pages = [...rows.pages];
  let from = 0;
  const last = pages.at(-1);
  if (last && last.length < size) {
    from = size - last.length;
    pages[pages.length - 1] = [...last, ...added.slice(0, from)];
  }
  for (; from < added.length; from += size) pages.push(added.slice(from, from + size));
  return paged(size, pages);
}

/** `rows` with the row of each row number in `changed` in place of the one there was. */
export function withRowsChanged<T>(
  rows: PagedRows<T>,
  changed: ReadonlyMap<number, T>,
): PagedRows<T> {
  if (changed.size === 0) return rows;
  const { size } = rows;
  const copies = new Map<number, T[]>();
  for (const [n, row] of changed) {
    if (rows.at(n) === undefined) continue;
    const p = Math.floor(n / size);
    let copy = copies.get(p);
    if (!copy) copies.set(p, (copy = [...rows.pages[p]!]));
    copy[n % size] = row;
  }
  return paged(
    size,
    rows.pages.map((page, p) => copies.get(p) ?? page),
  );
}
