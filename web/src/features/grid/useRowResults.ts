import { useEffect, useState } from 'react';
import { rowResultsDao } from '../../lib/storage';
import type { GridRow } from './columns';

/**
 * Loads stored rows for a tab; reloads when `trigger` (the tab's `rowDataTrigger`) changes.
 * Missing or failing reads give `[]`.
 */
export function useRowResults(tabId: string, trigger: number | null | undefined) {
  const [state, setState] = useState<{ rows: GridRow[]; loading: boolean }>({
    rows: [],
    loading: true,
  });
  useEffect(() => {
    let cancelled = false;
    void rowResultsDao
      .get(tabId)
      .catch(() => [] as GridRow[])
      .then((rows) => {
        if (!cancelled) setState({ rows: rows ?? [], loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [tabId, trigger]);
  return state;
}
