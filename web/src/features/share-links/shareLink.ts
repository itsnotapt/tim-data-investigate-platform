/**
 * A share link to a run: `#/runs/<runId>`, with `?row=<n>` naming one of its rows and
 * `idColumn=<column>` the Id column its results show with, when it isn't the one they open with.
 */
export function shareLink(
  runId: string,
  row: number | null = null,
  idColumn: string | null = null,
): string {
  const search = new URLSearchParams();
  if (row !== null) search.set('row', String(row));
  if (idColumn !== null) search.set('idColumn', idColumn);
  const query = search.size > 0 ? `?${search.toString()}` : '';
  return `${window.location.origin}${window.location.pathname}#/runs/${encodeURIComponent(runId)}${query}`;
}

/** The row `?row=` names, or `null` unless it is a row number. */
export function rowParam(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  return Number(value);
}

/**
 * Copies the share link to `runId`, or to its `row`, with the Id column `idColumn`, and says
 * whether it was copied.
 */
export async function copyShareLink(
  runId: string,
  row: number | null,
  notify: ((message: string) => void) | null,
  idColumn: string | null = null,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(shareLink(runId, row, idColumn));
    notify?.(row === null ? 'Copied a link to this result' : 'Copied a link to this row');
  } catch {
    notify?.("Couldn't copy the link");
  }
}
