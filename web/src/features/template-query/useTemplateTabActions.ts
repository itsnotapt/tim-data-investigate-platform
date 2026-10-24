import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useNotify } from '../../components/useNotify';
import { cloneTemplateTab, convertTemplateTab, runTemplateQuery } from './runTemplateQuery';

/**
 * Toolbar actions for `TemplateQueryTab`.
 */

/** `runTemplateQuery(uuid)` (no time range) plus the "Executing query..." snackbar. */
export function useRunTemplateQuery(): (uuid: string) => void {
  const notify = useNotify();
  return useCallback(
    (uuid) => {
      notify('Executing query...');
      void runTemplateQuery(uuid);
    },
    [notify],
  );
}

/** Clone as a sibling titled "Copy of <title>", same parent, not auto-run. */
export function useCloneTemplateQuery(): (uuid: string) => void {
  const navigate = useNavigate();
  return useCallback(
    (uuid) => {
      const copy = cloneTemplateTab(uuid);
      if (copy) void navigate(`/view/${copy}`);
    },
    [navigate],
  );
}

/** Convert to a custom `KustoQueryResult` with the rendered KQL (after the confirm dialog). */
export function useConvertTemplateQuery(): (uuid: string) => void {
  return useCallback((uuid) => {
    convertTemplateTab(uuid);
  }, []);
}
