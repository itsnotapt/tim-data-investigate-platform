import { useEffect, useState } from 'react';
import { rowResultsDao } from '../../lib/storage';
import type { GridRow } from './columns';

/**
 * Loads stored rows for a tab; reloads when `trigger` (the tab's `rowDataTrigger`) changes.
 * Missing or failing reads give `[]` (BUG-27: legacy threw after every query error).
 */
export function useRowResults(uuid: string, trigger: number | null | undefined) {
  const [state, setState] = useState<{ rows: GridRow[]; loading: boolean }>({
    rows: [],
    loading: true,
  });
  useEffect(() => {
    let cancelled = false;
    void rowResultsDao
      .get(uuid)
      .catch(() => [] as GridRow[])
      .then((rows) => {
        if (!cancelled) setState({ rows: rows ?? [], loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [uuid, trigger]);
  return state;
}
