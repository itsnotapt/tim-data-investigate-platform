import { rowResultsDao } from '../../lib/storage';
import { prepareRows, ROW_ID_FIELD } from './columns';
import type { GridRow, GridRowWithId } from './columns';

/** Persists changed rows into the tab's stored rows, matched by the grid row id (`_id`). */
async function persistRowUpdates(
  uuid: string,
  updates: readonly GridRowWithId[],
  columnId?: string | null,
): Promise<void> {
  const byId = new Map(updates.map((r) => [r[ROW_ID_FIELD], r]));
  const stored = await rowResultsDao.get(uuid);
  const ids = prepareRows(stored, columnId);
  const next = stored.map((row, i) => {
    const update = byId.get(ids[i]?.[ROW_ID_FIELD] ?? '');
    if (!update) return row;
    const raw: GridRow = { ...update };
    delete raw[ROW_ID_FIELD];
    return raw;
  });
  await rowResultsDao.put(uuid, next);
}

/**
 * Applies changed rows to the grid (transaction by `_id`, so formatting and row classes refresh)
 * and to the stored rows of tab `uuid`. The stored copy is updated too so a reload keeps the change.
 */
export async function applyRowUpdates(
  api: { applyTransaction(tx: { update: GridRowWithId[] }): unknown },
  uuid: string,
  updates: readonly GridRowWithId[],
  columnId?: string | null,
): Promise<void> {
  api.applyTransaction({ update: [...updates] });
  await persistRowUpdates(uuid, updates, columnId);
}
