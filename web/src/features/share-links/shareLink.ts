/**
 * A share link to a run: `#/runs/<runId>`, with `?row=<n>` naming one of its rows.
 */
export function shareLink(runId: string, row: number | null = null): string {
  const query = row === null ? '' : `?row=${row}`;
  return `${window.location.origin}${window.location.pathname}#/runs/${encodeURIComponent(runId)}${query}`;
}

/** The row `?row=` names, or `null` unless it is a row number. */
export function rowParam(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  return Number(value);
}

/** Copies the share link to `runId`, or to its `row`, and says whether it was copied. */
export async function copyShareLink(
  runId: string,
  row: number | null,
  notify: ((message: string) => void) | null,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(shareLink(runId, row));
    notify?.(row === null ? 'Copied a link to this result' : 'Copied a link to this row');
  } catch {
    notify?.("Couldn't copy the link");
  }
}
